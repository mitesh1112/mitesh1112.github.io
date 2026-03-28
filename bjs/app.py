"""
Certificate Lookup and Download Server
A Flask application to serve certificates with autocomplete lookup
"""

from flask import Flask, render_template, send_file, jsonify, send_from_directory
from flask_cors import CORS
import os
import json
from pathlib import Path

# Initialize Flask app
app = Flask(__name__, static_folder='.', static_url_path='')
CORS(app)

# Configuration
BASE_DIR = Path(__file__).parent
CERTS_DIR = BASE_DIR / 'certs'
DATA_FILE = BASE_DIR / 'data.json'

# Load data at startup
def load_data():
    """Load data from JSON file"""
    try:
        with open(DATA_FILE, 'r', encoding='utf-8') as f:
            return json.load(f)
    except Exception as e:
        print(f"Error loading data: {e}")
        return []

# Store data globally
data = load_data()

@app.route('/')
def index():
    """Serve the main page"""
    return send_file('index.html')

@app.route('/data.json')
def serve_data():
    """Serve the JSON data file"""
    return send_file('data.json', mimetype='application/json')

@app.route('/download/<filename>')
def download_certificate(filename):
    """
    Download certificate by filename
    Filename should be in format: CODE.jpg (e.g., A1.jpg, B5.jpg)
    """
    try:
        # Validate filename to prevent directory traversal
        filename = os.path.basename(filename)
        
        # Check if file exists
        cert_path = CERTS_DIR / filename
        if not cert_path.exists():
            return jsonify({'error': 'Certificate not found'}), 404
        
        # Verify it's a jpg file
        if not filename.lower().endswith('.jpg'):
            return jsonify({'error': 'Invalid file type'}), 400
        
        # Send the file
        return send_file(
            cert_path,
            mimetype='image/jpeg',
            as_attachment=True,
            download_name=filename
        )
    
    except Exception as e:
        print(f"Error downloading certificate: {e}")
        return jsonify({'error': 'Failed to download certificate'}), 500

@app.route('/api/search/<name>')
def search_certificate(name):
    """
    Search for certificates by name (for potential AJAX usage)
    """
    try:
        search_term = name.lower()
        matches = [item for item in data if search_term in item['name'].lower()]
        return jsonify(matches)
    except Exception as e:
        print(f"Error searching: {e}")
        return jsonify({'error': 'Search failed'}), 500

@app.route('/api/data')
def get_data():
    """Get all data (alternative endpoint)"""
    return jsonify(data)

@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors"""
    return jsonify({'error': 'Resource not found'}), 404

@app.errorhandler(500)
def internal_error(error):
    """Handle 500 errors"""
    return jsonify({'error': 'Internal server error'}), 500

if __name__ == '__main__':
    # Check if required directories exist
    if not CERTS_DIR.exists():
        print(f"Warning: Certificates directory not found at {CERTS_DIR}")
    
    if not DATA_FILE.exists():
        print(f"Warning: Data file not found at {DATA_FILE}")
    
    print(f"Starting Certificate Lookup Server...")
    print(f"Base Directory: {BASE_DIR}")
    print(f"Certificates Directory: {CERTS_DIR}")
    print(f"Open your browser to: http://localhost:5000")
    print(f"Press Ctrl+C to stop the server")
    
    # Run the Flask development server
    app.run(debug=True, host='0.0.0.0', port=5000)
