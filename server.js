const express = require('express');
const admin = require('firebase-admin');
const multer = require('multer');
const path = require('path');
const { IncomingForm } = require('formidable');
const fs = require('fs');

const app = express();

const MAX_FILE_SIZE = 50 * 1024 * 1024;
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: { fileSize: MAX_FILE_SIZE }
});

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '50mb' }));

let db = null;
let isValidServiceAccount = false;

function validateServiceAccountStructure(serviceAccount) {
    const requiredFields = [
        'type', 'project_id', 'private_key_id', 'private_key',
        'client_email', 'client_id', 'auth_uri', 'token_uri',
        'auth_provider_x509_cert_url', 'client_x509_cert_url'
    ];

    const hasAllFields = requiredFields.every(field =>
        serviceAccount.hasOwnProperty(field) &&
        serviceAccount[field] !== null &&
        serviceAccount[field] !== undefined &&
        serviceAccount[field] !== ''
    );

    const isValidType = serviceAccount.type === 'service_account';
    const hasValidEmail = serviceAccount.client_email.endsWith('.gserviceaccount.com');
    const hasValidPrivateKey = serviceAccount.private_key.includes('BEGIN PRIVATE KEY') &&
        serviceAccount.private_key.includes('END PRIVATE KEY');

    return hasAllFields && isValidType && hasValidEmail && hasValidPrivateKey;
}

async function commitBatchWithRetry(batch, collectionName, retries = 3) {
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            await batch.commit();
            return true;
        } catch (error) {
            console.log(`Batch commit attempt ${attempt} failed for ${collectionName}:`, error.message);
            if (attempt === retries) {
                throw error;
            }
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt) * 1000));
        }
    }
    return false;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function getCollectionsData(db) {
    const collections = await db.listCollections();
    const collectionsData = {};

    for (const collection of collections) {
        const docs = (await collection.get()).docs.map(doc => ({ id: doc.id, ...doc.data() }));
        collectionsData[collection.id] = docs;
    }

    return collectionsData;
}

app.post('/validate-service-account', upload.single('serviceAccount'), async (req, res) => {
    try {
        if (!req.file) {
            isValidServiceAccount = false;
            return res.status(400).json({
                success: false,
                error: 'No file uploaded'
            });
        }

        const serviceAccount = JSON.parse(req.file.buffer.toString());

        if (!validateServiceAccountStructure(serviceAccount)) {
            isValidServiceAccount = false;
            return res.status(400).json({
                success: false,
                error: 'Invalid service account structure'
            });
        }

        try {
            if (admin.apps.length) {
                await admin.app().delete();
            }

            admin.initializeApp({
                credential: admin.credential.cert(serviceAccount)
            });

            db = admin.firestore();
            await db.listCollections();

            isValidServiceAccount = true;
            res.json({
                success: true,
                message: 'Service account validated successfully'
            });
        } catch (error) {
            isValidServiceAccount = false;
            console.error('Firebase initialization error:', error);
            res.status(400).json({
                success: false,
                error: 'Invalid service account credentials',
                details: error.message
            });
        }
    } catch (error) {
        isValidServiceAccount = false;
        console.error('JSON parsing error:', error);
        res.status(400).json({
            success: false,
            error: 'Invalid JSON format',
            details: error.message
        });
    }
});

app.post('/upload', (req, res) => {
    const form = new IncomingForm();

    form.parse(req, async (err, fields, files) => {
        if (err) {
            return res.status(400).json({ 
                success: false, 
                message: 'Error processing the file.' 
            });
        }

        const credentialsFile = files.credentialsFile && files.credentialsFile[0];

        if (!credentialsFile) {
            return res.status(400).json({ 
                success: false, 
                message: 'Firebase credentials file is required.' 
            });
        }

        try {
            const credentials = JSON.parse(fs.readFileSync(credentialsFile.filepath, 'utf8'));

            if (admin.apps.length) {
                await admin.app().delete();
            }

            admin.initializeApp({
                credential: admin.credential.cert(credentials)
            });

            db = admin.firestore();
            const collections = await getCollectionsData(db);
            
            // Cleanup temporary file
            fs.unlinkSync(credentialsFile.filepath);
            
            res.json({ 
                success: true, 
                collections 
            });

        } catch (error) {
            console.error('Error processing file:', error);
            // Cleanup temporary file if it exists
            if (credentialsFile && fs.existsSync(credentialsFile.filepath)) {
                fs.unlinkSync(credentialsFile.filepath);
            }
            return res.status(500).json({ 
                success: false, 
                message: 'Error processing the file.',
                details: error.message 
            });
        }
    });
});

app.post('/upload-collection', upload.array('collections'), async (req, res) => {
    if (!isValidServiceAccount || !db) {
        return res.status(401).json({
            success: false,
            error: 'Valid service account required'
        });
    }

    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ error: 'No files uploaded' });
        }

        const results = [];

        for (const file of req.files) {
            try {
                console.log('Processing file:', file.originalname);
                const jsonData = JSON.parse(file.buffer.toString());
                const collectionName = path.parse(file.originalname).name;
                console.log('Collection name:', collectionName);

                let documents = [];

                if (Array.isArray(jsonData)) {
                    documents = jsonData;
                } else if (typeof jsonData === 'object') {
                    if (Object.keys(jsonData).length === 0) {
                        throw new Error('Empty JSON object');
                    }

                    if (Object.values(jsonData).every(val => typeof val === 'object')) {
                        documents = Object.entries(jsonData).map(([id, data]) => ({
                            ...data,
                            _id: id
                        }));
                    } else {
                        documents = [jsonData];
                    }
                } else {
                    throw new Error('Invalid JSON structure. Must be an object or array');
                }

                const batchSize = 15;
                let batchCount = 0;
                let batch = db.batch();
                let successCount = 0;

                for (let i = 0; i < documents.length; i++) {
                    const doc = documents[i];
                    const docId = doc._id || db.collection(collectionName).doc().id;
                    const docRef = db.collection(collectionName).doc(docId);

                    if (doc._id) {
                        delete doc._id;
                    }

                    batch.set(docRef, doc);
                    batchCount++;

                    if (batchCount === batchSize || i === documents.length - 1) {
                        if (batchCount > 0) {
                            console.log(`Committing batch for ${collectionName}: ${batchCount} documents`);
                            try {
                                await commitBatchWithRetry(batch, collectionName);
                                successCount += batchCount;
                                await sleep(1000); 
                            } catch (batchError) {
                                console.error(`Batch commit failed for ${collectionName}:`, batchError);
                                throw batchError;
                            }
                        }
                        batch = db.batch();
                        batchCount = 0;
                    }
                }

                results.push({
                    collection: collectionName,
                    documentsUploaded: successCount,
                    totalDocuments: documents.length
                });

                console.log('Successfully processed:', collectionName);
            } catch (fileError) {
                console.error('Error processing file:', file.originalname, fileError);
                results.push({
                    collection: path.parse(file.originalname).name,
                    error: fileError.message
                });
            }
        }

        res.json({
            success: true,
            results,
            errors: results.filter(r => r.error)
        });
    } catch (error) {
        console.error('Upload collection error:', error);
        res.status(500).json({
            error: 'Error uploading collections',
            details: error.message,
            stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    res.status(500).json({
        error: 'Internal server error',
        details: err.message,
        stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});