document.addEventListener('DOMContentLoaded', function () {
    const fileInput = document.getElementById('jsonFile');
    const submitButton = document.getElementById('submitButton');
    const originalButtonText = submitButton.textContent;
    const searchInput = document.getElementById('searchInput');
    const selectAllCheckbox = document.getElementById('selectAllCheckbox');
    const selectAllCheckboxFooter = document.getElementById('selectAllCheckboxFooter');
    const paginationContainer = document.getElementById('pagination');
    const collectionsList = document.getElementById('collectionsList');
    const downloadSelectedButton = document.getElementById('downloadSelectedButton');

    let collectionsData = [];
    let currentPage = 1;
    const itemsPerPage = 5;
    let selectedCollections = new Set();

    function toggleSubmitButton() {
        if (fileInput.files.length > 0) {
            submitButton.disabled = false;
        } else {
            submitButton.disabled = true;
        }
    }

    fileInput.addEventListener('change', toggleSubmitButton);
    toggleSubmitButton();

    document.getElementById('uploadForm').addEventListener('submit', async function (event) {
        event.preventDefault();
    
        submitButton.innerHTML = '<span class="loading loading-bars loading-xs"></span>';
    
        const formData = new FormData();
        formData.append('credentialsFile', fileInput.files[0]);
    
        const endpoint = '/upload';
    
        try {
            const response = await fetch(endpoint, {
                method: 'POST',
                body: formData
            });
    
            const data = await response.json();
            console.log('Received data:', data);
    
            submitButton.innerHTML = originalButtonText;
    
            if (data.success) {
                collectionsData = Object.keys(data.collections).map(collection => ({
                    name: collection,
                    data: data.collections[collection]
                }));
                updateCollectionsList();
                updatePagination();
            } else {
                alert('Error: ' + data.message);
            }
        } catch (error) {
            console.error('Error:', error);
            alert('An error occurred while processing the request.');
            submitButton.innerHTML = originalButtonText;
        }
    });
    
    function updateCollectionsList(filteredData = collectionsData) {
        collectionsList.innerHTML = '';

        const startIndex = (currentPage - 1) * itemsPerPage;
        const endIndex = startIndex + itemsPerPage;
        const pageData = filteredData.slice(startIndex, endIndex);

        if (pageData.length === 0) {
            const dataNotFoundRow = document.createElement('tr');
            const dataNotFoundCell = document.createElement('td');
            dataNotFoundCell.setAttribute('colspan', '3');
            dataNotFoundCell.classList.add('text-center');
            dataNotFoundCell.textContent = 'Data not found';
            dataNotFoundRow.appendChild(dataNotFoundCell);
            collectionsList.appendChild(dataNotFoundRow);
        } else {
            pageData.forEach(collection => {
                const row = document.createElement('tr');
                const checkboxCell = document.createElement('td');
                checkboxCell.classList.add('truncate');
                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.classList.add('checkbox', 'checkbox-xs', 'rounded-none');
                checkbox.dataset.collectionName = collection.name;
                checkbox.checked = selectedCollections.has(collection.name);
                checkbox.addEventListener('change', function () {
                    if (checkbox.checked) {
                        selectedCollections.add(collection.name);
                    } else {
                        selectedCollections.delete(collection.name);
                    }
                    checkSelected();
                });
                checkboxCell.appendChild(checkbox);
                row.appendChild(checkboxCell);

                const collectionCell = document.createElement('td');
                collectionCell.classList.add('truncate');
                collectionCell.textContent = collection.name;
                row.appendChild(collectionCell);

                const actionCell = document.createElement('td');
                actionCell.classList.add('truncate');
                const downloadButton = document.createElement('button');
                downloadButton.classList.add('btn', 'bg-base-100', 'btn-xs', 'btn-square', 'border-2', 'border-black', 'rounded-none');
                const downloadIcon = document.createElement('i');
                downloadIcon.classList.add('bi', 'bi-download');
                downloadButton.appendChild(downloadIcon);

                downloadButton.addEventListener('click', function () {
                    const backupData = {
                        collection: collection.name,
                        data: collection.data
                    };

                    const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });

                    const a = document.createElement('a');
                    a.href = URL.createObjectURL(blob);
                    a.download = `${collection.name}_backup.json`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                });

                actionCell.appendChild(downloadButton);
                row.appendChild(actionCell);

                collectionsList.appendChild(row);
            });
        }
    }

    function updatePagination() {
        const totalPages = Math.ceil(collectionsData.length / itemsPerPage);

        const existingPageButtons = paginationContainer.querySelectorAll('.page-button');
        existingPageButtons.forEach(button => button.remove());

        for (let i = 1; i <= totalPages; i++) {
            const pageButton = document.createElement('button');
            pageButton.classList.add('join-item', 'btn', 'btn-xs', 'rounded-none', 'page-button');
            pageButton.textContent = i;
            pageButton.dataset.page = i;

            if (i === currentPage) {
                pageButton.classList.add('btn-active');
            }

            pageButton.addEventListener('click', function () {
                currentPage = parseInt(pageButton.dataset.page);
                updateCollectionsList();
                updatePagination();
            });

            paginationContainer.insertBefore(pageButton, document.getElementById('nextButton'));
        }

        const prevButton = document.getElementById('prevButton');
        const nextButton = document.getElementById('nextButton');

        prevButton.disabled = currentPage === 1;
        nextButton.disabled = currentPage === totalPages;
    }

    const prevButton = document.getElementById('prevButton');
    const nextButton = document.getElementById('nextButton');

    prevButton.addEventListener('click', function () {
        if (currentPage > 1) {
            currentPage--;
            updateCollectionsList();
            updatePagination();
        }
    });

    nextButton.addEventListener('click', function () {
        const totalPages = Math.ceil(collectionsData.length / itemsPerPage);
        if (currentPage < totalPages) {
            currentPage++;
            updateCollectionsList();
            updatePagination();
        }
    });

    searchInput.addEventListener('input', function () {
        currentPage = 1;

        const searchTerm = searchInput.value.toLowerCase();

        const filteredCollections = collectionsData.filter(collection =>
            collection.name.toLowerCase().includes(searchTerm)
        );

        updateCollectionsList(filteredCollections);
        updatePagination();
    });

    function toggleSelectAll(checked) {
        const checkboxes = document.querySelectorAll('#collectionsList input[type="checkbox"]');
        checkboxes.forEach(checkbox => {
            checkbox.checked = checked;
            const collectionName = checkbox.dataset.collectionName;
            if (checked) {
                selectedCollections.add(collectionName);
            } else {
                selectedCollections.delete(collectionName);
            }
        });
        checkSelected();
    }

    function checkSelected() {
        downloadSelectedButton.disabled = selectedCollections.size < 2;
    }

    selectAllCheckbox.addEventListener('change', function () {
        const isChecked = selectAllCheckbox.checked;
        selectAllCheckboxFooter.checked = isChecked;
        toggleSelectAll(isChecked);
    });

    selectAllCheckboxFooter.addEventListener('change', function () {
        const isChecked = selectAllCheckboxFooter.checked;
        selectAllCheckbox.checked = isChecked;
        toggleSelectAll(isChecked);
    });

    downloadSelectedButton.addEventListener('click', function () {
        const zip = new JSZip();

        selectedCollections.forEach(collectionName => {
            const collection = collectionsData.find(item => item.name === collectionName);
            if (collection) {
                zip.file(`${collection.name}.json`, JSON.stringify(collection.data, null, 2));
            }
        });

        zip.generateAsync({ type: 'blob' }).then(function (content) {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(content);
            a.download = 'selected_collections.zip';
            a.click();
        });
    });

});