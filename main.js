const obsidian = require('obsidian');

const DEFAULT_SETTINGS = {
    githubUser: '',
    githubRepo: '',
    githubToken: '',
    folderPath: '',
    branch: 'main'
};

class GitHubMediaUploader extends obsidian.Plugin {
    async onload() {
        await this.loadSettings();

        this.registerEvent(
            this.app.workspace.on('editor-paste', this.handlePaste.bind(this))
        );

        this.registerEvent(
            this.app.vault.on('create', this.handleFileCreate.bind(this))
        );

        this.addSettingTab(new SettingsTab(this.app, this));
        console.log("GitHub Media Uploader Loaded");
    }

    async handlePaste(evt, editor, view) {
        const files = evt.clipboardData.files;
        if (files.length === 0) return; 
        
        const file = files[0];
        if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) return;

        evt.preventDefault(); 
        
        await this.processUpload(file, editor, true);
    }

    async handleFileCreate(file) {
        const isImage = ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(file.extension);
        const isVideo = ['mp4', 'webm', 'mov'].includes(file.extension);
        if (!isImage && !isVideo) return;

        const activeLeaf = this.app.workspace.activeLeaf;
        if (!activeLeaf || activeLeaf.view.getViewType() !== 'markdown') return;

        const editor = activeLeaf.view.editor;
        
        await new Promise(r => setTimeout(r, 100));

        const content = editor.getValue();
        const linkString = `![[${file.name}]]`; 
        if (!content.includes(file.name)) return; 

        new obsidian.Notice(`⬆️ Mobile Upload Detected: ${file.name}`);

        const binary = await this.app.vault.readBinary(file);
        const base64Data = obsidian.arrayBufferToBase64(binary);

        const fileObj = {
            name: file.name,
            type: isImage ? `image/${file.extension}` : `video/${file.extension}`,
            base64: base64Data, 
            size: file.stat.size
        };

        const success = await this.processUpload(fileObj, editor, false, linkString);

        if (success) {
            await this.app.vault.delete(file);
        }
    }

    async processUpload(fileObj, editor, isPasteEvent, linkToReplace = null) {
        const sizeInMB = fileObj.size / (1024 * 1024);
        if (sizeInMB > 25) {
            new obsidian.Notice(`❌ File too big (${sizeInMB.toFixed(1)}MB). Limit 25MB.`);
            return false;
        }

        const user = this.settings.githubUser.trim();
        const repo = this.settings.githubRepo.trim();
        const token = this.settings.githubToken.trim();
        const branch = this.settings.branch.trim();

        if (!user || !repo || !token) {
            new obsidian.Notice("❌ Configure GitHub settings.");
            return false;
        }

        const placeholder = `![Uploading ${fileObj.name}...](${Date.now()})`;
        if (isPasteEvent) {
            editor.replaceSelection(placeholder);
        } else if (linkToReplace) {
            const current = editor.getValue();
            editor.setValue(current.replace(linkToReplace, placeholder));
        }

        try {
            let base64Data = fileObj.base64;
            if (!base64Data && fileObj instanceof File) {
                base64Data = await this.fileToBase64(fileObj);
            }

            const fileName = `${Date.now()}-${fileObj.name.replace(/\s+/g, '-')}`;
            
            let folder = this.settings.folderPath.trim();
            if (folder.endsWith('/')) folder = folder.slice(0, -1);
            const path = folder ? `${folder}/${fileName}` : fileName;

            await this.uploadToGithub(user, repo, token, branch, path, base64Data);

            const rawUrl = `https://raw.githubusercontent.com/${user}/${repo}/${branch}/${path}`;
            const isImage = fileObj.type.startsWith('image/');
            
            let embedCode = isImage ? `![](${rawUrl})` : `<video src="${rawUrl}" controls></video>`;

            const currentContent = editor.getValue();
            if (currentContent.includes(placeholder)) {
                 editor.setValue(currentContent.replace(placeholder, embedCode));
            } else {
                 editor.replaceSelection(embedCode);
            }
            
            new obsidian.Notice(`✅ Uploaded: ${fileName}`);
            return true;

        } catch (error) {
            console.error(error);
            new obsidian.Notice(`❌ Upload Failed: ${error.message}`);
            const currentContent = editor.getValue();
            editor.setValue(currentContent.replace(placeholder, `[Upload Failed: ${fileObj.name}]`));
            return false;
        }
    }

    fileToBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const result = reader.result;
                const base64 = result.substr(result.indexOf(',') + 1);
                resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }

    async uploadToGithub(user, repo, token, branch, path, content) {
        const url = `https://api.github.com/repos/${user}/${repo}/contents/${path}`;
        
        try {
            const response = await obsidian.requestUrl({
                url: url,
                method: 'PUT',
                headers: {
                    'Authorization': `token ${token}`,
                    'Content-Type': 'application/json',
                    'User-Agent': 'Obsidian-Plugin'
                },
                body: JSON.stringify({
                    message: `Upload ${path}`,
                    content: content,
                    branch: branch
                })
            });
            
            if (response.status !== 200 && response.status !== 201) {
                throw new Error(`GitHub Status ${response.status}`);
            }
        } catch (e) {
            if (e.status === 404) throw new Error(`Repo not found (404). Check Username/Repo.`);
            if (e.status === 401) throw new Error(`Invalid Token (401).`);
            if (e.status === 413) throw new Error(`File too large (413).`);
            throw e;
        }
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}

class SettingsTab extends obsidian.PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl('h2', { text: 'GitHub Media Uploader Settings' });

        new obsidian.Setting(containerEl)
            .setName('GitHub Username')
            .addText(text => text.setValue(this.plugin.settings.githubUser)
                .onChange(async (v) => { this.plugin.settings.githubUser = v; await this.plugin.saveSettings(); }));

        new obsidian.Setting(containerEl)
            .setName('Repository Name')
            .addText(text => text.setValue(this.plugin.settings.githubRepo)
                .onChange(async (v) => { this.plugin.settings.githubRepo = v; await this.plugin.saveSettings(); }));
        
        new obsidian.Setting(containerEl)
            .setName('Branch')
            .setDesc('Usually main')
            .addText(text => text.setValue(this.plugin.settings.branch)
                .onChange(async (v) => { this.plugin.settings.branch = v; await this.plugin.saveSettings(); }));

        new obsidian.Setting(containerEl)
            .setName('Folder Path')
            .setDesc('e.g. "assets". Leave empty for root.')
            .addText(text => text.setValue(this.plugin.settings.folderPath)
                .onChange(async (v) => { this.plugin.settings.folderPath = v; await this.plugin.saveSettings(); }));

        new obsidian.Setting(containerEl)
            .setName('GitHub Token')
            .setDesc('Requires "repo" scope.')
            .addText(text => text.setPlaceholder('ghp_...')
                .setValue(this.plugin.settings.githubToken)
                .onChange(async (v) => { this.plugin.settings.githubToken = v; await this.plugin.saveSettings(); }));
    }
}


module.exports = GitHubMediaUploader;
