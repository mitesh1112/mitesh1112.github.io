# Certificate Lookup and Download System

A **100% static web application** that allows users to search for certificates by name with autocomplete functionality and download the corresponding certificate images. Works on GitHub Pages, Netlify, Vercel, or any static hosting.

## Features

✨ **Key Features:**
- 🔍 **Autocomplete Search**: Type a name and get instant suggestions
- 📋 **Display Details**: Shows certificate code, name, class, and school information
- 📥 **Download Certificates**: One-click download of certificate JPG files
- 📱 **Responsive Design**: Works on desktop, tablet, and mobile devices
- 🎨 **Modern UI**: Beautiful gradient design with smooth animations
- 🚀 **No Backend Required**: 100% static HTML/CSS/JavaScript

## Project Structure

```
bjs/
├── index.html          # Main webpage (all-in-one file, ready to deploy)
├── certs/              # Folder containing certificate JPG files
│   ├── A1.jpg
│   ├── A2.jpg
│   └── ...
├── bjs.csv             # Original CSV data (reference only)
├── data.json           # Optional: JSON data file (not needed if using index.html)
├── README.md           # This file
└── Other files (for local Python server; not needed for GitHub Pages)
```

## Deployment on GitHub Pages

### Quick Start

1. **Create a GitHub Repository** or use existing one

2. **Upload Files to Repository**
   ```
   Files needed:
   ├── index.html        (copy from this project)
   └── certs/            (entire folder with .jpg files)
   ```

3. **Enable GitHub Pages**
   - Go to repository Settings → Pages
   - Select "Deploy from a branch"
   - Choose your branch (usually `main`)
   - Save

4. **Your site will be live at:**
   ```
   https://yourusername.github.io/your-repo-name/
   ```
   Or with a custom domain if configured.

5. **That's it!** No backend, no server configuration needed.

### Alternative Static Hosts

This also works on:
- **Netlify**: Drag and drop the folder
- **Vercel**: Connect your GitHub repo
- **AWS S3 + CloudFront**: Upload to S3
- **Firebase Hosting**: Deploy with Firebase CLI
- **Any web server**: Just upload the files

## Local Testing

### Option 1: Open HTML File Directly
```bash
# Windows: Double-click index.html
# Or right-click → Open with → Browser
```
**Note:** Might have CORS restrictions when loading from `file://`

### Option 2: Use Python's Built-in Server (Recommended)
```bash
# Python 3
python -m http.server 8000

# Python 2
python -m SimpleHTTPServer 8000
```
Then visit: `http://localhost:8000/index.html`

### Option 3: Use Live Server (VS Code)
- Install "Live Server" extension in VS Code
- Right-click on `index.html` → "Open with Live Server"

## How to Use

1. **Search for Name**
   - Type a name in the search box
   - See autocomplete suggestions as you type
   - Partial names work (e.g., typing "Tushar" will find "Tushar Makwana")

2. **Select a Person**
   - Click on a suggestion from the dropdown list
   - Or use arrow keys to navigate and Enter to select

3. **View Details**
   - Certificate code, name, class, and school are displayed

4. **Download Certificate**
   - Click the "📥 Download Certificate" button
   - The JPG file will be downloaded automatically
   - File naming: `CODE_NAME.jpg` (e.g., `A1_Tushar_Makwana.jpg`)

## File Organization

### When Deploying to GitHub Pages

```
your-repo/
├── index.html               # Main file (rename to index.html)
└── certs/                    # Certificate files directory
    ├── A1.jpg
    ├── A2.jpg
    ├── A3.jpg
    └── ... (all certificates)
```

**Important**: All certificate files must be in a `certs/` folder at the same level as `index.html`.

### Certificate File Naming

Certificate filenames must match the codes in the data:
- Code `A1` → Filename: `A1.jpg`
- Code `A2` → Filename: `A2.jpg`
- File must be in `certs/` subfolder
- Format: JPG image files

## Customization

### Add More People/Data

Edit `index.html` and find the `embeddedData` array around line 234:

```javascript
const embeddedData = [
  {"code": "A1", "name": "Tushar Makwana", "std": "7", "school": "..."},
  {"code": "A2", "name": "Naimish Sanjay Parmar", "std": "7", "school": "..."},
  // Add more entries here
];
```

Add new objects to this array with:
- `code`: Certificate code (e.g., "B1")
- `name`: Person's full name
- `std`: Class/Grade
- `school`: School name
- `mobile1`, `mobile2`: Phone numbers (optional)

### Styling

Change colors by editing the CSS section (lines 13-190):
- `background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);` - Background
- `border-color: #667eea;` - Primary color

## Browser Compatibility

✅ Works on:
- Chrome/Chromium (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)
- Mobile browsers (iOS Safari, Chrome Android)

## Troubleshooting

### Certificate Not Found Error
**Problem**: "Failed to download certificate"
**Solution**: 
- Check that certificate files are in `certs/` folder
- Verify filename matches the code (e.g., `A1.jpg` for code "A1")
- Ensure `.jpg` file extension (case-sensitive on Linux)

### Autocomplete Not Showing
**Problem**: Search suggestions not appearing
**Solution**:
- Check browser console (F12 → Console) for errors
- Try clearing browser cache
- Refresh the page

### No Results When Searching
**Problem**: Can't find any names
**Solution**:
- Check that `embeddedData` array has data in `index.html`
- Try searching for partial names
- Search is case-insensitive

### Downloads Not Working
**Problem**: Download button does nothing
**Solution**:
- Verify certificates exist in `certs/` folder
- Check browser download folder
- Try a different browser

## Performance

- ⚡ Instant autocomplete (no server latency)
- 📦 Very small file size (embedded data = no extra requests)
- 🔒 No external dependencies (works offline once loaded)
- 📱 Optimized for mobile

## Security

- ✅ No backend = no security vulnerabilities
- ✅ No database = no data breaches
- ✅ Static files only
- ⚠️ All data is embedded in HTML (client-side only)

## License

This is a private application for certificate management.

## Support

For issues:
1. Check browser console (Press F12)
2. Verify file structure matches requirements
3. Test in a different browser
4. Check internet connection

---

**Last Updated:** March 2026  
**Version:** 2.0 (GitHub Pages Ready)
