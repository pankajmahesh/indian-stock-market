# Indian Stock Screener

Indian Stock Screener is a full-stack project for screening NSE stocks, ranking candidates through a multi-step pipeline, and viewing the results in a React dashboard backed by a Flask API.

## What This Project Does

- Builds a stock universe from NSE-related data sources
- Removes companies that fail red-flag checks
- Scores stocks on fundamental and technical factors
- Produces a ranked shortlist and final picks
- Exposes screener output through a Flask API
- Displays the data in a React + Vite frontend

## Tech Stack

- Backend: Python
- API: Flask + Flask-SocketIO
- Frontend: React + Vite
- Data tools: pandas, numpy, yfinance, ta

## Project Structure

```text
.
├── api_server.py        # Flask API server for the dashboard
├── main.py              # Main screening pipeline
├── config.py            # Project configuration
├── modules/             # Pipeline modules and scoring logic
├── utils/               # Shared helpers
├── data/                # Cached data, generated files, outputs
├── frontend/            # React frontend
├── nse_proxy/           # Proxy-related code
├── requirements.txt     # Python dependencies
└── start.sh             # Starts backend + frontend together
```

## Requirements

- Python 3
- Node.js and npm

## Backend Setup

Install Python dependencies:

```bash
pip3 install -r requirements.txt
```

Run the full screening pipeline:

```bash
python3 main.py
```

Useful pipeline options:

```bash
python3 main.py --step 3
python3 main.py --skip-cache
python3 main.py --top-n 30
python3 main.py --final-n 20
```

Start the API server manually:

```bash
python3 api_server.py
```

## Frontend Setup

Move into the frontend folder and install packages:

```bash
cd frontend
npm install
```

Start the frontend development server:

```bash
npm run dev
```

Build the frontend:

```bash
npm run build
```

## Run Full Stack Together

From the project root:

```bash
./start.sh
```

This script:

- starts the Flask API server
- starts the React dev server
- warns if screener output data has not been generated yet

Expected local URLs:

- API: `http://127.0.0.1:5001/api/summary`
- Frontend: `http://localhost:3000`

## Data Notes

Generated output files are stored under the `data/` directory. If the UI shows missing data, run the pipeline first:

```bash
python3 main.py
```

## Authentication

The API includes authentication routes and user storage in the `data/` directory. Review `config.py` for auth-related settings before deploying or sharing the app.

## Development Notes

- `main.py` orchestrates the end-to-end screening pipeline
- `api_server.py` serves processed data to the frontend
- `frontend/README.md` still contains the default Vite template and can be replaced later with app-specific frontend documentation
