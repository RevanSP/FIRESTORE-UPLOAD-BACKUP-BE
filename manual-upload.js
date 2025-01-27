const fs = require('fs');
const admin = require('firebase-admin');

// Initialize Firebase Admin SDK
// NOTE: Replace './serviceAccountKey.json' with the path to your actual service account key file
const serviceAccount = require('./bookverse-d0d48-firebase-adminsdk-fbsvc-ec9b5ccc7e.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// Function to delay execution
const sleep = (ms) => {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// Function to read JSON file and upload data to Firestore
async function uploadJsonToFirestore(data, collectionName, batchSize = 50) {
  try {
    const collectionRef = db.collection(collectionName);
    const totalBatches = Math.ceil(data.length / batchSize);
    let uploadedCount = 0;

    for (let i = 0; i < data.length; i += batchSize) {
      const batch = db.batch();
      const batchData = data.slice(i, i + batchSize);

      batchData.forEach((item, index) => {
        const docRef = collectionRef.doc(`doc_${i + index + 1}`);
        batch.set(docRef, item);
      });

      await batch.commit();
      uploadedCount += batchData.length;

      // Displaying progress manually
      const progress = Math.round((uploadedCount / data.length) * 100);
      console.log(`Progress: ${progress}% (${uploadedCount}/${data.length} items uploaded)`);
      console.log(`Batch ${Math.floor(i / batchSize) + 1} of ${totalBatches} has been successfully uploaded to Firestore`);

      // Delay of 1 second between batches
      await sleep(1000);
    }

    console.log('All data has been successfully uploaded to Firestore');
  } catch (error) {
    console.error('Error uploading data to Firestore:', error);
  }
}

// Example usage
const filePath = 'manhwa-komikindo.json'; // Placeholder for JSON file path
const collectionName = 'manhwa'; // Placeholder for Firestore collection name

fs.readFile(filePath, 'utf8', (err, data) => {
  if (err) {
    console.error('Error reading JSON file:', err);
    return;
  }

  try {
    const jsonData = JSON.parse(data);
    uploadJsonToFirestore(jsonData, collectionName, 50); // Default batchSize is set to 50
  } catch (error) {
    console.error('Error parsing JSON data:', error);
  }
});