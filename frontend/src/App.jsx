import React, { useState } from 'react';
import './App.css'
import RealtorScraper from './RealtorScraper';
import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import { Upload, Download, Search, AlertCircle, CheckCircle, Loader } from 'lucide-react';

function App() {

  const [file, setFile] = useState(null);
  const [allData, setAllData] = useState([]);
  const [needsScrapingData, setNeedsScrapingData] = useState([]);
  const [stats, setStats] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [logs, setLogs] = useState([]);
  const [completed, setCompleted] = useState(false);

  // const API_BASE_URL = 'http://167.71.81.58/api/realtors/'; 
const API_BASE_URL = 'http://localhost:3001/api';

  const addLog = (message, type = 'info') => {
    setLogs(prev => [...prev, { message, type, time: new Date().toLocaleTimeString() }]);
  };

  const handleFileUpload = async (e) => {
    const uploadedFile = e.target.files[0];
    if (!uploadedFile) return;

    setFile(uploadedFile);
    addLog('Parsing CSV file...', 'info');
    
    // Parse CSV via backend
    const formData = new FormData();
    formData.append('file', uploadedFile);

    try {
      const response = await fetch(`${API_BASE_URL}/parse-csv`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        throw new Error('Failed to parse CSV');
      }

      const result = await response.json();
      
      setAllData(result.allRealtors);
      setNeedsScrapingData(result.needsScraping);
      setStats(result.stats);
      
      addLog(`Loaded ${result.stats.total} realtors from CSV`, 'success');
      addLog(`${result.stats.hasComplete} already have contact info`, 'info');
      addLog(`${result.stats.needsScraping} need scraping`, 'warning');
    } catch (error) {
      addLog(`Error parsing CSV: ${error.message}`, 'error');
    }
  };

  const processRealtor = async (realtor, index) => {
    addLog(`Searching: ${realtor.firstName} ${realtor.lastName}`, 'info');

    try {
      const response = await fetch(`${API_BASE_URL}/scrape-realtor`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          realtor: {
            firstName: realtor.firstName,
            lastName: realtor.lastName,
            company: realtor.company
          }
        })
      });

      if (!response.ok) {
        throw new Error('Scraping failed');
      }

      const result = await response.json();

      // Update only the needsScraping data
      setNeedsScrapingData(prev => {
        const updated = [...prev];
        updated[index] = result;
        return updated;
      });
      
      // Also update in allData
      setAllData(prev => {
        const updated = [...prev];
        const allIndex = updated.findIndex(r => 
          r.firstName === realtor.firstName && 
          r.lastName === realtor.lastName && 
          r.company === realtor.company
        );
        if (allIndex !== -1) {
          updated[allIndex] = result;
        }
        return updated;
      });

      if (result.email || result.phone) {
        addLog(`Found: ${result.email || result.phone} (${result.confidence}% confidence)`, 'success');
      } else {
        addLog(`No contact info found for ${realtor.firstName} ${realtor.lastName}`, 'warning');
      }
    } catch (error) {
      addLog(`Error processing ${realtor.firstName} ${realtor.lastName}: ${error.message}`, 'error');
    }
  };

  const startScraping = async () => {


    if (needsScrapingData.length === 0) {
      addLog('No realtors need scraping. All have contact info!', 'success');
      return;
    }

    setProcessing(true);
    setCompleted(false);
    setLogs([]);
    addLog(`Starting scraping process for ${needsScrapingData.length} realtors...`, 'info');

    for (let i = 0; i < needsScrapingData.length; i++) {
      await processRealtor(needsScrapingData[i], i);
      setProgress(((i + 1) / needsScrapingData.length) * 100);
    }

    setProcessing(false);
    setCompleted(true);
    addLog('Scraping completed!', 'success');
  };

  const downloadCSV = () => {
    const headers = ['First Name', 'Last Name', 'Company', 'Email', 'Phone', 'Source'];
    const rows = allData.map(r => [
      r.firstName, r.lastName, r.company, r.email, r.phone, r.source
    ]);

    const csv = [headers, ...rows]
      .map(row => row.map(cell => `"${cell}"`).join(','))
      .join('\n');

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'realtors_with_contacts.csv';
    a.click();
    window.URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen ">
      <div className="max-w-4xl mx-auto">
        <div className="bg-white border-4 border-blue-500/100  shadow-xl p-8">
          <div className="flex items-center gap-3 mb-8 mx-auto">
            <h1 className="text-2xl font-bold text-gray-900">Realtor Contact Scraper</h1>
          </div>

          {/* API Key Input */}
          {/* <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              SerpAPI Key
            </label>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Enter your SerpAPI key"
              className="w-full px-4 py-2 border border-gray-300  focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
            <p className="text-xs text-gray-500 mt-1">
              Get your API key from <a href="https://serpapi.com/" target="_blank" rel="noopener noreferrer" className="text-indigo-600 hover:underline">SerpAPI</a>
            </p>
          </div> */}

          {/* File Upload */}
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Upload CSV File
            </label>
            <div className="border-2 border-dashed border-gray-300  p-8 text-center hover:border-indigo-400 transition">
              <input
                type="file"
                accept=".csv"
                onChange={handleFileUpload}
                className="hidden"
                id="file-upload"
              />
              <label htmlFor="file-upload" className="cursor-pointer">
                <p className="text-gray-600">
                  {file ? file.name : 'Click to upload CSV file'}
                </p>
                <p className="text-sm text-gray-400 mt-2">CSV must contain first_name, last_name and company columns</p>
              </label>
            </div>
          </div>

          {/* Data Preview */}
          {stats && (
            <div className="mb-6 ">
              <div className="grid grid-cols-2 gap-4 mb-4 ">
                <div className="bg-blue-100   p-4">
                  <div className="text-2xl font-bold text-blue-600">{stats.total}</div>
                  <div className="text-sm text-blue-800">Total Realtors</div>
                </div>
                {/* <div className="bg-green-200   p-4">
                  <div className="text-2xl font-bold text-green-600">{stats.hasComplete}</div>
                  <div className="text-sm text-green-800">Have Contact Info</div>
                </div> */}
                <div className="bg-orange-100  p-4">
                  <div className="text-2xl font-bold text-orange-600">{stats.needsScraping}</div>
                  <div className="text-sm text-orange-800">Need Scraping</div>
                </div>
              </div>
              
              {needsScrapingData.length > 0 && (
                <>
                  <h3 className="text-lg font-semibold mb-3 text-gray-800">
                    Realtors Missing Contact Info ({needsScrapingData.length})
                  </h3>
                  <div className="bg-orange-100   p-4 max-h-48 overflow-y-auto">
                    {needsScrapingData.slice(0, 10).map((r, i) => (
                      <div key={i} className="text-sm text-gray-700 mb-2 flex justify-between">
                        <span className="font-medium">{r.firstName} {r.lastName}</span>
                        <span className="text-gray-500">{r.company}</span>
                        <span className="text-xs text-orange-600">
                          {!r.email && !r.phone ? 'No contact' : !r.email ? 'Missing email' : 'Missing phone'}
                        </span>
                      </div>
                    ))}
                    {needsScrapingData.length > 10 && (
                      <div className="text-sm text-gray-400 mt-2">...and {needsScrapingData.length - 10} more</div>
                    )}
                  </div>
                </>
              )}
              
              {needsScrapingData.length === 0 && (
                <div className="bg-green-200   p-4">
                  <p className="text-green-800 font-medium">All realtors have contact information</p>
                  <p className="text-sm text-green-700 mt-1">No scraping needed.</p>
                </div>
              )}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-4 mb-6">
            <button
              onClick={startScraping}
              disabled={processing || needsScrapingData.length === 0 }
              className="flex-1 bg-indigo-600 text-white px-6 py-3  rounded-full font-semibold hover:bg-indigo-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition flex items-center justify-center gap-2"
            >
              {processing ? (
                <>
                  <Loader className="w-5 h-5 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  Start Scraping ({needsScrapingData.length})
                </>
              )}
            </button>

            {completed && (
              <button
                onClick={downloadCSV}
                className="flex-1 bg-green-600 text-white px-6 py-3 rounded-full font-semibold hover:bg-green-700 transition flex items-center justify-center gap-2"
              >
                
                Download Results
              </button>
            )}
          </div>

          {/* Progress Bar */}
          {processing && (
            <div className="mb-6">
              <div className="w-full bg-gray-200 rounded-full h-3">
                <div
                  className="bg-indigo-600 h-3 rounded-full transition-all duration-300"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <p className="text-sm text-gray-600 mt-2 text-center">
                {Math.round(progress)}% Complete
              </p>
            </div>
          )}

          {/* Logs */}
          {logs.length > 0 && (
            <div className="bg-gray-900  p-4 max-h-96 overflow-y-auto">
              <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
                
                Activity Log
              </h3>
              {logs.map((log, i) => (
                <div key={i} className="flex items-start gap-2 mb-2 text-sm">
                  <span className="text-gray-500">[{log.time}]</span>
                  {log.type === 'success' }
                  {log.type === 'error' }
                  <span className={`
                    ${log.type === 'success' ? 'text-green-400' : ''}
                    ${log.type === 'error' ? 'text-red-400' : ''}
                    ${log.type === 'warning' ? 'text-yellow-400' : ''}
                    ${log.type === 'info' ? 'text-gray-300' : ''}
                  `}>
                    {log.message}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Results Summary */}
          {completed && (
            <div className="mt-6 bg-green-100   p-4">
              <h3 className="font-semibold text-green-800 mb-2">Scraping Complete!</h3>
              <div className="text-sm text-green-700">
                <p>Processed {needsScrapingData.length} realtors</p>
                <p className="mt-1">
                  Found Emails: {needsScrapingData.filter(r => r.email).length} | 
                  Found Phones: {needsScrapingData.filter(r => r.phone).length}
                </p>
                <p className="mt-2 text-xs">
                  Total in CSV: {allData.filter(r => r.email).length} emails, {allData.filter(r => r.phone).length} phones
                </p>
              </div>
            </div>
          )}
        </div>

        {/* Instructions */}
        {/* <div className="mt-6 bg-white  shadow-lg p-6">
          <h3 className="font-semibold text-gray-800 mb-3">How to Use</h3>
          <ol className="list-decimal list-inside space-y-2 text-sm text-gray-600">
            <li>Get a SerpAPI key from serpapi.com</li>
            <li>Prepare a CSV file with "Name" and "Company" columns</li>
            <li>Enter your API key and upload the CSV file</li>
            <li>Click "Start Scraping" to begin the automated search</li>
            <li>Download the results CSV with email and phone information</li>
          </ol>
          <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded">
            <p className="text-xs text-yellow-800">
              <strong>Note:</strong> Make sure the Node.js backend is running on port 3001. 
              This tool respects robots.txt and only scrapes from allowed domains.
            </p>
          </div>
        </div> */}
      </div>
    </div>
  );
};

export default App
