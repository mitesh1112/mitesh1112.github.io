# Deploying to GitHub Pages - Quick Guide

## Step 1: Create/Use GitHub Repository

Go to [github.com](https://github.com) and:
- Create a new repository OR use an existing one
- Make sure it's public (for free GitHub Pages)
- Repository name can be anything (e.g., `certificates`, `bjs-certs`)

## Step 2: Upload Files

You need exactly these files in your repository:

```
repository/
├── README.md                (optional, but good to have)
├── index.html               (the main webpage file)
└── certs/                   (folder with certificate JPGs)
    ├── A1.jpg
    ├── A2.jpg
    ├── A3.jpg
    └── ... (all your certificates)
```

### Upload Options:

**Option A: Via GitHub Web Interface (Easiest)**
```
1. Go to your repository
2. Click "Add file" → "Upload files"
3. Drag and drop index.html
4. Then create a new folder:
   - Click "Add file" → "Create new file"
   - Type: certs/A1.jpg
   - Upload your first certificate
5. Repeat for all certificates
```

**Option B: Via Git Command Line**
```bash
# Clone your repository
git clone https://github.com/yourusername/your-repo.git
cd your-repo

# Copy index.html and certs folder here
# (use Windows file explorer to copy files)

# Add and commit
git add .
git commit -m "Add certificate lookup application"
git push origin main
```

**Option C: Via GitHub Desktop App**
```
1. Download GitHub Desktop from desktop.github.com
2. Clone your repository
3. Copy index.html and certs/ folder into that folder
4. GitHub Desktop will show changes
5. Click "Commit to main"
6. Click "Push origin"
```

## Step 3: Enable GitHub Pages

1. Go to your repository on GitHub
2. Click **Settings** (tab at top)
3. Click **Pages** (left sidebar)
4. Under "Build and deployment":
   - Select "Deploy from a branch"
   - Branch: `main` (or your branch)
   - Folder: `/ (root)` 
5. Click **Save**

GitHub will now build and deploy your site!

## Step 4: Access Your Site

Your site will be live at:
```
https://yourusername.github.io/your-repo-name/
```

For example:
- Repository name: `certificates`
- URL: `https://yourusername.github.io/certificates/`

You can share this URL with anyone!

## Custom Domain (Optional)

Want to use your own domain?

1. Buy a domain (godaddy.com, namecheap.com, etc.)
2. In Settings → Pages → "Custom domain"
3. Enter your domain name
4. Update DNS records at your domain registrar

(Instructions for DNS setup will appear in GitHub)

## Troubleshooting

### Site not loading?
- Wait 1-2 minutes for GitHub to build
- Check that file is exactly named `index.html`
- Make sure `certs/` folder exists with JPG files

### Autocomplete works but downloads fail?
- Verify `certs/` folder exists in repository root
- Check certificate filenames match codes (A1.jpg, A2.jpg, etc.)
- Refresh browser

### Updating the site?
- Edit files in repository
- Commit and push changes
- Wait 30 seconds for site to update

## Still Want to Test Locally First?

```bash
# Navigate to your folder with index.html and certs/
cd path/to/bjs

# Start Python server
python -m http.server 8000

# Open in browser
# http://localhost:8000/index.html
```

## What Not To Upload

❌ Do NOT upload these to GitHub:
- `app.py` (Python backend - not needed)
- `requirements.txt` (Python packages - not needed)
- `data.json` (data is embedded in index.html)
- `run_server.bat` (local script - not needed)
- `bjs.csv` (original data - not needed)

✅ Upload ONLY:
- `index.html`
- `certs/` folder with all JPG files
- `README.md` (optional)

## Need Help?

- GitHub Pages docs: https://pages.github.com
- GitHub help: https://docs.github.com
- Ask in GitHub Discussions or Issues

---

That's it! Your certificate lookup app is now live on the internet! 🎉
