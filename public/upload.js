const checkServiceAccountButton = document.getElementById("checkServiceAccountButton");
const uploadButton = document.getElementById("uploadButton");
const serviceAccountInput = document.getElementById("serviceAccountInput");
const collectionInput = document.getElementById("collectionInput");

let isServiceAccountValid = false;

const validateServiceAccountUrl = '/validate-service-account';
const uploadCollectionUrl = '/upload-collection';

async function validateServiceAccount(file) {
    const formData = new FormData();
    formData.append('serviceAccount', file);

    try {
        const { success } = await fetch(validateServiceAccountUrl, { method: 'POST', body: formData }).then(res => res.json());
        isServiceAccountValid = success;
        checkServiceAccountButton.disabled = !success;
        showTemporaryMessage(checkServiceAccountButton, success ? "" : "FAILED", success ? "text-green-500" : "text-red-500");
    } catch {
        isServiceAccountValid = false;
        checkServiceAccountButton.disabled = true;
        showTemporaryMessage(checkServiceAccountButton, "FAILED", "text-red-500");
    }
}

function showTemporaryMessage(button, message, className) {
    button.classList.add(className);
    button.innerText = message || "CHECK SERVICE ACCOUNT KEY";
    setTimeout(() => {
        button.classList.remove(className);
        button.innerText = "CHECK SERVICE ACCOUNT KEY";
    }, 3000);
}

function updateUploadButtonState() {
    uploadButton.disabled = !(isServiceAccountValid && collectionInput.files.length > 0);
}

serviceAccountInput.addEventListener("change", () => {
    const file = serviceAccountInput.files[0];
    if (file?.name.endsWith(".json")) {
        validateServiceAccount(file);
    } else {
        checkServiceAccountButton.disabled = true;
        uploadButton.disabled = true;
    }
});

collectionInput.addEventListener("change", updateUploadButtonState);

checkServiceAccountButton.addEventListener("click", updateUploadButtonState);

uploadButton.addEventListener("click", async () => {
    const files = collectionInput.files;
    if (!files.length) return;

    uploadButton.innerHTML = '<span class="loading loading-ring loading-xs"></span>';
    uploadButton.disabled = true;

    const formData = new FormData();
    Array.from(files).forEach(file => formData.append('collections', file));

    try {
        const { success, errors, results, details } = await fetch(uploadCollectionUrl, { method: 'POST', body: formData }).then(res => res.json());
        if (success) {
            collectionInput.value = '';
            showButtonState('success', results, errors);
        } else {
            console.error('Failed to upload collections:', details);
            showButtonState('failure');
        }
    } catch (error) {
        console.error('Upload error:', error.message);
        showButtonState('failure');
    } finally {
        uploadButton.disabled = false;
    }
});

function showButtonState(type, results = [], errors = []) {
    const icon = type === 'success' ? 'check2-circle' : 'x-circle';
    uploadButton.innerHTML = `<i class="bi bi-${icon}"></i>`;
    setTimeout(() => uploadButton.innerHTML = '<i class="bi bi-cloud-upload"></i>', 3000);
    if (type === 'success' && errors.length) {
        console.log(`Partial success. Some files had errors:\n${errors.map(e => `${e.collection}: ${e.error}`).join('\n')}`);
    }
}