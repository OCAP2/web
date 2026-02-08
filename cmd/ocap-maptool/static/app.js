(function() {
    'use strict';

    const dropZone = document.getElementById('drop-zone');
    const fileInput = document.getElementById('file-input');
    const toolsList = document.getElementById('tools-list');
    const mapsBody = document.getElementById('maps-body');
    const noMaps = document.getElementById('no-maps');
    const jobsSection = document.getElementById('jobs-section');
    const activeJobDiv = document.getElementById('active-job');
    const previewPopup = document.getElementById('preview-popup');

    // Drag and drop
    dropZone.addEventListener('click', () => fileInput.click());
    dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
    dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
    dropZone.addEventListener('drop', e => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
    });
    fileInput.addEventListener('change', () => { if (fileInput.files.length) uploadFiles(fileInput.files); });

    async function uploadFiles(fileList) {
        const file = Array.from(fileList).find(f => f.name.toLowerCase().endsWith('.zip'));
        if (!file) {
            alert('Please upload a .zip file');
            return;
        }
        const form = new FormData();
        form.append('file', file);
        dropZone.querySelector('p').textContent = 'Uploading ' + file.name + '...';

        try {
            const res = await fetch('/api/maps/import', { method: 'POST', body: form });
            const job = await res.json();
            if (res.ok) {
                pollJob(job.id);
            } else {
                alert('Upload failed: ' + (job.error || 'unknown error'));
            }
        } catch (err) {
            alert('Upload failed: ' + err.message);
        }
        dropZone.querySelector('p').innerHTML = 'Drop grad_meh ZIP here or <label for="file-input">click to upload</label>';
    }

    function pollJob(jobId, onComplete) {
        jobsSection.hidden = false;
        const interval = setInterval(async () => {
            try {
                const res = await fetch('/api/jobs/' + jobId);
                const job = await res.json();
                let text = '<strong>' + esc(job.worldName) + '</strong> — ' + esc(job.status);
                if (job.stage) {
                    text += ' — stage ' + job.stageNum + '/' + job.totalStages + ': ' + esc(job.stage);
                }
                if (job.error) {
                    text += ' (' + esc(job.error) + ')';
                }
                activeJobDiv.innerHTML = text;
                if (job.status === 'done' || job.status === 'failed') {
                    clearInterval(interval);
                    loadMaps();
                    if (onComplete) onComplete(job);
                    if (job.status === 'done') {
                        setTimeout(() => { jobsSection.hidden = true; }, 3000);
                    }
                }
            } catch (e) {
                clearInterval(interval);
                if (onComplete) onComplete(null);
            }
        }, 1000);
    }

    async function loadTools() {
        try {
            const res = await fetch('/api/tools');
            const tools = await res.json();
            toolsList.innerHTML = tools.map(t => {
                let cls = t.found ? 'found' : (t.required ? 'missing' : 'optional');
                let icon = t.found ? '\u2713' : (t.required ? '\u2717' : '?');
                let suffix = !t.required ? ' (optional)' : '';
                return '<span class="tool ' + cls + '">' + icon + ' ' + t.name + suffix + '</span>';
            }).join('');
        } catch (e) {
            toolsList.textContent = 'Failed to load tools';
        }
    }

    async function loadMaps() {
        try {
            const res = await fetch('/api/maps');
            const maps = await res.json();
            if (!maps || maps.length === 0) {
                mapsBody.innerHTML = '';
                noMaps.hidden = false;
                return;
            }
            noMaps.hidden = true;
            mapsBody.innerHTML = maps.map(m => {
                var img = m.hasPreview
                    ? '<img src="maps/' + encodeURIComponent(m.name) + '/preview_256.png" alt="" class="map-preview" data-preview="maps/' + encodeURIComponent(m.name) + '/preview_512.png">'
                    : '<span class="map-preview-placeholder"></span>';
                return '<tr>' +
                    '<td>' + img + '</td>' +
                    '<td>' + m.name + '</td>' +
                    '<td>' + (m.worldSize ? m.worldSize + 'm' : '-') + '</td>' +
                    '<td><span class="status status-' + m.status + '">' + m.status + '</span></td>' +
                    '<td><button class="btn btn-danger" onclick="deleteMap(\'' + m.name + '\')">' +
                    'Delete</button></td>' +
                    '</tr>';
            }).join('');
        } catch (e) {
            mapsBody.innerHTML = '';
            noMaps.textContent = 'Failed to load maps';
            noMaps.hidden = false;
        }
    }

    window.deleteMap = async function(name) {
        if (!confirm('Delete map "' + name + '"? This cannot be undone.')) return;
        await fetch('/api/maps/' + name, { method: 'DELETE' });
        loadMaps();
    };

    function esc(s) {
        const d = document.createElement('div');
        d.textContent = s;
        return d.innerHTML;
    }

    // Preview popup via event delegation
    mapsBody.addEventListener('mouseenter', function(e) {
        var src = e.target.dataset && e.target.dataset.preview;
        if (!src) return;
        var rect = e.target.getBoundingClientRect();
        previewPopup.src = src;
        var top = rect.top + rect.height / 2 - 128;
        top = Math.max(8, Math.min(top, window.innerHeight - 264));
        previewPopup.style.left = (rect.left - 264) + 'px';
        previewPopup.style.top = top + 'px';
        previewPopup.style.display = 'block';
    }, true);
    mapsBody.addEventListener('mouseleave', function(e) {
        if (e.target.dataset && e.target.dataset.preview) {
            previewPopup.style.display = 'none';
        }
    }, true);

    // Restyle all maps
    const restyleBtn = document.getElementById('restyle-all-btn');
    restyleBtn.addEventListener('click', async () => {
        if (!confirm('Restyle all maps? This regenerates styles and sprites for every map.')) return;
        restyleBtn.disabled = true;
        try {
            const res = await fetch('/api/maps/restyle', { method: 'POST' });
            const job = await res.json();
            if (res.ok) {
                pollJob(job.id, () => { restyleBtn.disabled = false; });
            } else {
                alert('Restyle failed: ' + (job.error || 'unknown error'));
                restyleBtn.disabled = false;
            }
        } catch (err) {
            alert('Restyle failed: ' + err.message);
            restyleBtn.disabled = false;
        }
    });

    // Initial load
    loadTools();
    loadMaps();
})();
