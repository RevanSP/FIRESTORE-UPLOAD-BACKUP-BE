import { Hono } from "hono";
import { cors } from "hono/cors";

const app = new Hono();

app.use(
  "/*",
  cors({
    origin: "https://revansp.github.io",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"],
  })
);

let isValidServiceAccount = false;

function validateServiceAccountStructure(serviceAccount) {
  const requiredFields = [
    "type",
    "project_id",
    "private_key_id",
    "private_key",
    "client_email",
    "client_id",
    "auth_uri",
    "token_uri",
    "auth_provider_x509_cert_url",
    "client_x509_cert_url",
  ];

  const hasAllFields = requiredFields.every(
    (field) =>
      serviceAccount.hasOwnProperty(field) &&
      serviceAccount[field] !== null &&
      serviceAccount[field] !== undefined &&
      serviceAccount[field] !== ""
  );

  const isValidType = serviceAccount.type === "service_account";
  const hasValidEmail =
    serviceAccount.client_email &&
    serviceAccount.client_email.endsWith(".gserviceaccount.com");
  const hasValidPrivateKey =
    serviceAccount.private_key &&
    serviceAccount.private_key.includes("BEGIN PRIVATE KEY") &&
    serviceAccount.private_key.includes("END PRIVATE KEY");

  return {
    valid: hasAllFields && isValidType && hasValidEmail && hasValidPrivateKey,
    errors: {
      missingFields: !hasAllFields,
      invalidType: !isValidType,
      invalidEmail: !hasValidEmail,
      invalidPrivateKey: !hasValidPrivateKey,
    },
  };
}

async function validateServiceAccountComplete(serviceAccount) {
  const validationResult = {
    valid: false,
    checks: {
      structure: false,
      authentication: false,
      iam: true,
      firestore: false,
      firebase: false,
    },
    accountInfo: null,
    errors: [],
  };

  try {
    console.log("Starting structure validation...");
    const structureCheck = validateServiceAccountStructure(serviceAccount);
    validationResult.checks.structure = structureCheck.valid;

    if (!structureCheck.valid) {
      validationResult.errors.push({
        type: "structure",
        message: "Invalid service account structure",
        details: structureCheck.errors,
      });
      return validationResult;
    }

    // 2. Authentication validation (get access token)
    console.log("Starting authentication validation...");
    let accessToken;
    try {
      accessToken = await getAccessToken(serviceAccount);
      validationResult.checks.authentication = !!accessToken;
    } catch (error) {
      validationResult.errors.push({
        type: "authentication",
        message: "Failed to authenticate with Google APIs",
        details: error.message,
      });
      return validationResult;
    }

    // 3. IAM Service Account validation (Skipped and set to true)
    console.log("IAM validation is skipped and set to true.");
    validationResult.checks.iam = true; // Always true as per request

    // 4. Firebase Project validation
    console.log("Starting Firebase validation...");
    const firebaseCheck = await validateFirebaseProject(
      serviceAccount,
      accessToken
    );
    validationResult.checks.firebase = firebaseCheck.valid;

    if (!firebaseCheck.valid) {
      validationResult.errors.push({
        type: "firebase",
        message: "Firebase project validation failed",
        details: firebaseCheck.error,
      });
    }

    // 5. Firestore access validation
    console.log("Starting Firestore validation...");
    const firestoreCheck = await validateFirestoreAccess(
      serviceAccount,
      accessToken
    );
    validationResult.checks.firestore = firestoreCheck.valid;

    if (!firestoreCheck.valid) {
      validationResult.errors.push({
        type: "firestore",
        message: "Firestore access validation failed",
        details: firestoreCheck.error,
      });
    }

    // 6. Service Account Key validation
    console.log("Starting key validation...");
    const keyCheck = await validateServiceAccountKey(
      serviceAccount,
      accessToken
    );

    // Collect account information
    validationResult.accountInfo = {
      email: serviceAccount.client_email,
      projectId: serviceAccount.project_id,
      keyId: serviceAccount.private_key_id,
      clientId: serviceAccount.client_id,
      validatedAt: new Date().toISOString(),
      permissions: [], // Permissions will be empty as IAM check is skipped
      keyInfo: keyCheck.keyInfo,
      projectInfo: firebaseCheck.projectInfo,
    };

    // Determine overall validity
    validationResult.valid =
      validationResult.checks.authentication &&
      validationResult.checks.iam &&
      validationResult.checks.firebase;

    console.log("Validation completed:", validationResult.checks);
    return validationResult;
  } catch (error) {
    validationResult.errors.push({
      type: "general",
      message: "Validation process failed",
      details: error.message,
    });
    return validationResult;
  }
}

async function validateFirebaseProject(serviceAccount, accessToken) {
  try {
    const response = await fetch(
      `https://firebase.googleapis.com/v1beta1/projects/${serviceAccount.project_id}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      if (response.status === 404) {
        throw new Error("Firebase project not found or not accessible");
      }
      if (response.status === 403) {
        throw new Error(
          "Service account lacks Firebase project access permissions"
        );
      }
      throw new Error(
        `Firebase API error: ${response.status} ${response.statusText}`
      );
    }

    const projectData = await response.json();

    if (projectData.state !== "ACTIVE") {
      throw new Error(
        `Firebase project is not active. Current state: ${projectData.state}`
      );
    }

    return {
      valid: true,
      projectInfo: {
        projectId: projectData.projectId,
        displayName: projectData.displayName,
        state: projectData.state,
        projectNumber: projectData.projectNumber,
      },
    };
  } catch (error) {
    return {
      valid: false,
      error: error.message,
    };
  }
}

async function validateFirestoreAccess(serviceAccount, accessToken) {
  try {
    const response = await fetch(
      `https://firestore.googleapis.com/v1/projects/${serviceAccount.project_id}/databases/(default)`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      if (response.status === 403) {
        throw new Error("Service account lacks Firestore access permissions");
      }
      if (response.status === 404) {
        throw new Error("Firestore database not found or not enabled");
      }
      throw new Error(
        `Firestore API error: ${response.status} ${response.statusText}`
      );
    }

    const databaseInfo = await response.json();

    try {
      const collectionsResponse = await fetch(
        `https://firestore.googleapis.com/v1/projects/${serviceAccount.project_id}/databases/(default)/documents:listCollectionIds`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        }
      );

      const canListCollections = collectionsResponse.ok;

      return {
        valid: true,
        databaseInfo,
        permissions: {
          canRead: true,
          canList: canListCollections,
        },
      };
    } catch (e) {
      return {
        valid: true,
        databaseInfo,
        permissions: {
          canRead: true,
          canList: false,
        },
      };
    }
  } catch (error) {
    return {
      valid: false,
      error: error.message,
    };
  }
}

async function validateServiceAccountKey(serviceAccount, accessToken) {
  try {
    const response = await fetch(
      `https://iam.googleapis.com/v1/projects/${serviceAccount.project_id}/serviceAccounts/${serviceAccount.client_email}/keys`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      }
    );

    if (!response.ok) {
      throw new Error(
        `Keys API error: ${response.status} ${response.statusText}`
      );
    }

    const data = await response.json();
    const currentKey = data.keys?.find((key) =>
      key.name.includes(serviceAccount.private_key_id)
    );

    if (!currentKey) {
      throw new Error("Service account key not found in the project");
    }

    const now = new Date();
    const validAfter = new Date(currentKey.validAfterTime);
    const validBefore = new Date(currentKey.validBeforeTime);

    if (now < validAfter) {
      throw new Error("Service account key is not yet valid");
    }

    if (now > validBefore) {
      throw new Error("Service account key has expired");
    }

    return {
      valid: true,
      keyInfo: {
        keyId: serviceAccount.private_key_id,
        validAfter: currentKey.validAfterTime,
        validBefore: currentKey.validBeforeTime,
        keyType: currentKey.keyType,
        keyAlgorithm: currentKey.keyAlgorithm,
        daysUntilExpiry: Math.ceil((validBefore - now) / (1000 * 60 * 60 * 24)),
      },
    };
  } catch (error) {
    return {
      valid: false,
      error: error.message,
      keyInfo: null,
    };
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function getAccessToken(serviceAccount) {
  const now = Math.floor(Date.now() / 1000);
  const jwt = await createJWT(
    {
      iss: serviceAccount.client_email,
      scope:
        "https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase",
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now,
    },
    serviceAccount.private_key
  );

  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(
      `Token request failed: ${errorData.error_description || errorData.error}`
    );
  }

  const data = await response.json();
  return data.access_token;
}

async function createJWT(payload, privateKey) {
  const header = {
    alg: "RS256",
    typ: "JWT",
  };

  const encodedHeader = btoa(JSON.stringify(header))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
  const encodedPayload = btoa(JSON.stringify(payload))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");

  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const key = await crypto.subtle.importKey(
    "pkcs8",
    str2ab(
      atob(
        privateKey
          .replace(/-----BEGIN PRIVATE KEY-----/, "")
          .replace(/-----END PRIVATE KEY-----/, "")
          .replace(/\s/g, "")
      )
    ),
    {
      name: "RSASSA-PKCS1-v1_5",
      hash: "SHA-256",
    },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(signingInput)
  );

  const encodedSignature = btoa(
    String.fromCharCode(...new Uint8Array(signature))
  )
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");

  return `${signingInput}.${encodedSignature}`;
}

function str2ab(str) {
  const buf = new ArrayBuffer(str.length);
  const bufView = new Uint8Array(buf);
  for (let i = 0, strLen = str.length; i < strLen; i++) {
    bufView[i] = str.charCodeAt(i);
  }
  return buf;
}

async function getRootCollectionIds(projectId, accessToken) {
  const response = await fetch(
    `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:listCollectionIds`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch collection IDs: ${response.statusText}`);
  }

  const data = await response.json();
  return data.collectionIds || [];
}

async function getDocumentsInCollection(
  projectId,
  accessToken,
  collectionName
) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collectionName}`;

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to fetch documents for ${collectionName}: ${response.statusText}`
    );
  }

  const data = await response.json();

  return (data.documents || []).map((doc) => {
    const fields = {};
    for (const [key, value] of Object.entries(doc.fields)) {
      fields[key] = parseFirestoreValue(value);
    }
    return {
      id: doc.name.split("/").pop(),
      ...fields,
    };
  });
}

function parseFirestoreValue(value) {
  if ("stringValue" in value) return value.stringValue;
  if ("integerValue" in value) return parseInt(value.integerValue);
  if ("doubleValue" in value) return value.doubleValue;
  if ("booleanValue" in value) return value.booleanValue;
  if ("nullValue" in value) return null;
  if ("mapValue" in value) {
    const obj = {};
    const fields = value.mapValue.fields || {};
    for (const [k, v] of Object.entries(fields)) {
      obj[k] = parseFirestoreValue(v);
    }
    return obj;
  }
  if ("arrayValue" in value) {
    const arr = value.arrayValue.values || [];
    return arr.map(parseFirestoreValue);
  }
  return null;
}

async function uploadDocument(
  projectId,
  accessToken,
  collectionName,
  docId,
  docData
) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/${collectionName}/${docId}`;

  const response = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      fields: convertToFirestoreFields(docData),
    }),
  });

  return response.ok;
}

function convertToFirestoreFields(obj) {
  const fields = {};

  for (const [key, value] of Object.entries(obj)) {
    if (value === null) {
      fields[key] = { nullValue: null };
    } else if (typeof value === "boolean") {
      fields[key] = { booleanValue: value };
    } else if (typeof value === "number") {
      if (Number.isInteger(value)) {
        fields[key] = { integerValue: value.toString() };
      } else {
        fields[key] = { doubleValue: value };
      }
    } else if (typeof value === "string") {
      fields[key] = { stringValue: value };
    } else if (Array.isArray(value)) {
      fields[key] = {
        arrayValue: {
          values: value.map((v) => convertToFirestoreFields({ temp: v }).temp),
        },
      };
    } else if (typeof value === "object") {
      fields[key] = { mapValue: { fields: convertToFirestoreFields(value) } };
    }
  }

  return fields;
}

async function parseMultipartForm(request) {
  const formData = await request.formData();
  const files = {};
  const fields = {};

  for (const [key, value] of formData.entries()) {
    if (value instanceof File) {
      files[key] = [
        {
          originalFilename: value.name,
          buffer: await value.arrayBuffer(),
        },
      ];
    } else {
      fields[key] = value;
    }
  }

  return { fields, files };
}

app.post("/validate-service-account", async (c) => {
  try {
    const { files } = await parseMultipartForm(c.req.raw);
    const serviceAccountFile = files.serviceAccount && files.serviceAccount[0];

    if (!serviceAccountFile) {
      isValidServiceAccount = false;
      return c.json(
        {
          success: false,
          error: "No service account file uploaded",
        },
        400
      );
    }

    let serviceAccount;
    try {
      serviceAccount = JSON.parse(
        new TextDecoder().decode(serviceAccountFile.buffer)
      );
    } catch (error) {
      isValidServiceAccount = false;
      return c.json(
        {
          success: false,
          error: "Invalid JSON format in service account file",
          details: error.message,
        },
        400
      );
    }

    console.log("Starting comprehensive service account validation...");
    const validationResult = await validateServiceAccountComplete(
      serviceAccount
    );

    if (!validationResult.valid) {
      isValidServiceAccount = false;
      return c.json(
        {
          success: false,
          error: "Service account validation failed",
          checks: validationResult.checks,
          errors: validationResult.errors,
          details: validationResult.errors
            .map((e) => `${e.type}: ${e.message}`)
            .join("; "),
        },
        400
      );
    }

    c.env.SERVICE_ACCOUNT = JSON.stringify(serviceAccount);
    isValidServiceAccount = true;

    return c.json({
      success: true,
      message: "Service account validated successfully",
      checks: validationResult.checks,
      accountInfo: validationResult.accountInfo,
      warnings: validationResult.errors.filter((e) => e.type === "warning"),
    });
  } catch (error) {
    isValidServiceAccount = false;
    console.error("Service account validation error:", error);
    return c.json(
      {
        success: false,
        error: "Validation process failed",
        details: error.message,
      },
      500
    );
  }
});

app.post("/backup", async (c) => {
  try {
    const { files } = await parseMultipartForm(c.req.raw);
    const credentialsFile = files.credentialsFile && files.credentialsFile[0];

    if (!credentialsFile) {
      return c.json(
        {
          success: false,
          message: "Firebase credentials file is required.",
        },
        400
      );
    }

    try {
      const credentials = JSON.parse(
        new TextDecoder().decode(credentialsFile.buffer)
      );
      const accessToken = await getAccessToken(credentials);
      const collections = await getRootCollectionIds(
        credentials.project_id,
        accessToken
      );

      const result = [];

      for (const collectionName of collections) {
        const documents = await getDocumentsInCollection(
          credentials.project_id,
          accessToken,
          collectionName
        );
        result.push({
          collection: collectionName,
          documents,
        });
      }

      return c.json({
        success: true,
        collections: result,
      });
    } catch (error) {
      console.error("Error processing backup:", error);
      return c.json(
        {
          success: false,
          message: "Error processing the backup.",
          details: error.message,
        },
        500
      );
    }
  } catch (error) {
    console.error("Backup error:", error);
    return c.json(
      {
        success: false,
        message: "Error processing the backup request.",
        details: error.message,
      },
      400
    );
  }
});

app.post("/upload-collection", async (c) => {
  if (!isValidServiceAccount) {
    return c.json(
      {
        success: false,
        error:
          "Valid service account required. Please validate your service account first.",
      },
      401
    );
  }

  try {
    const { files } = await parseMultipartForm(c.req.raw);
    const collectionFiles = files.collections;

    if (!collectionFiles || collectionFiles.length === 0) {
      return c.json(
        {
          success: false,
          error: "No collection files uploaded",
        },
        400
      );
    }

    const serviceAccount = JSON.parse(c.env.SERVICE_ACCOUNT || "{}");
    const accessToken = await getAccessToken(serviceAccount);
    const results = [];

    for (const file of collectionFiles) {
      try {
        console.log("Processing file:", file.originalFilename);
        const jsonData = JSON.parse(new TextDecoder().decode(file.buffer));
        const collectionName = file.originalFilename.replace(/\.[^/.]+$/, "");
        console.log("Collection name:", collectionName);

        let documents = [];

        if (Array.isArray(jsonData)) {
          documents = jsonData;
        } else if (typeof jsonData === "object") {
          if (Object.keys(jsonData).length === 0) {
            throw new Error("Empty JSON object");
          }

          if (Object.values(jsonData).every((val) => typeof val === "object")) {
            documents = Object.entries(jsonData).map(([id, data]) => ({
              ...data,
              _id: id,
            }));
          } else {
            documents = [jsonData];
          }
        } else {
          throw new Error("Invalid JSON structure. Must be an object or array");
        }

        let successCount = 0;

        for (let i = 0; i < documents.length; i++) {
          const doc = documents[i];
          const docId = doc._id || `doc_${Date.now()}_${i}`;

          if (doc._id) {
            delete doc._id;
          }

          try {
            const success = await uploadDocument(
              serviceAccount.project_id,
              accessToken,
              collectionName,
              docId,
              doc
            );

            if (success) {
              successCount++;
            }

            if (i % 10 === 0) {
              await sleep(1000);
            }
          } catch (docError) {
            console.error(`Error uploading document ${docId}:`, docError);
          }
        }

        results.push({
          collection: collectionName,
          documentsUploaded: successCount,
          totalDocuments: documents.length,
          success: successCount > 0,
        });

        console.log("Successfully processed:", collectionName);
      } catch (fileError) {
        console.error(
          "Error processing file:",
          file.originalFilename,
          fileError
        );
        results.push({
          collection: file.originalFilename.replace(/\.[^/.]+$/, ""),
          error: fileError.message,
          success: false,
        });
      }
    }

    const hasErrors = results.some((r) => r.error);
    const hasSuccesses = results.some((r) => r.success);

    return c.json({
      success: hasSuccesses,
      results,
      summary: {
        totalFiles: collectionFiles.length,
        successfulFiles: results.filter((r) => r.success).length,
        failedFiles: results.filter((r) => r.error).length,
        totalDocumentsUploaded: results.reduce(
          (sum, r) => sum + (r.documentsUploaded || 0),
          0
        ),
      },
      errors: results.filter((r) => r.error),
    });
  } catch (error) {
    console.error("Upload collection error:", error);
    return c.json(
      {
        success: false,
        error: "Error uploading collections",
        details: error.message,
      },
      500
    );
  }
});

app.onError((err, c) => {
  console.error("Unhandled error:", err);
  return c.json(
    {
      success: false,
      error: "Internal server error",
      details: err.message,
    },
    500
  );
});

export default app;