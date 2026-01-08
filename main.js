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
        this.addSettingTab(new SettingsTab(this.app, this));
        console.log("GitHub Media Uploader Loaded");
    }

    async handlePaste(evt, editor, view) {
        const files = evt.clipboardData.files;
        if (files.length === 0) return;
        
        const file = files[0];
        const isImage = file.type.startsWith('image/');
        const isVideo = file.type.startsWith('video/');

        if (!isImage && !isVideo) return;

        const sizeInMB = file.size / (1024 * 1024);
        if (sizeInMB > 25) {
            new obsidian.Notice(`❌ File too big (${sizeInMB.toFixed(1)}MB). GitHub API limit is 25MB.`);
            return;
        }

        const user = this.settings.githubUser.trim();
        const repo = this.settings.githubRepo.trim();
        const token = this.settings.githubToken.trim();
        const branch = this.settings.branch.trim();

        if (!user || !repo || !token) {
            new obsidian.Notice("❌ Please configure GitHub settings first.");
            return;
        }

        evt.preventDefault();
        const placeholder = `![Uploading ${file.name}...]()`;
        editor.replaceSelection(placeholder);

        try {
            const base64Data = await this.fileToBase64(file);
            const fileName = `${Date.now()}-${file.name.replace(/\s+/g, '-')}`;
            
            let folder = this.settings.folderPath.trim();
            if (folder.endsWith('/')) folder = folder.slice(0, -1);
            const path = folder ? `${folder}/${fileName}` : fileName;

            new obsidian.Notice(`⬆️ Uploading ${file.type}...`);
            await this.uploadToGithub(user, repo, token, branch, path, base64Data);

            const rawUrl = `https://raw.githubusercontent.com/${user}/${repo}/${branch}/${path}`;
            
            let embedCode = "";
            if (isImage) {
                embedCode = `![](${rawUrl})`;
            } else if (isVideo) {
                embedCode = `<video src="${rawUrl}" controls></video>`;
            }

            const currentContent = editor.getValue();
            const newContent = currentContent.replace(placeholder, embedCode);
            editor.setValue(newContent);
            
            new obsidian.Notice(`✅ Uploaded: ${fileName}`);

        } catch (error) {
            console.error(error);
            new obsidian.Notice(`❌ Upload Failed: ${error.message}`);
            const currentContent = editor.getValue();
            editor.setValue(currentContent.replace(placeholder, `[Upload Failed: ${error.message}]`));
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
