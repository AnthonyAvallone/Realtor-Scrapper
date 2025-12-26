const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const multer = require('multer');
const csv = require('csv-parser');
const { Readable } = require('stream');

const app = express();
const upload = multer({ storage: multer.memoryStorage() });

// Middleware
app.use(cors());
app.use(express.json());

// API key 
// const SERPAPI_KEY = process.env.SERPAPI_KEY; 
const SERPAPI_KEY ='2bd6055e24b0ab4236ba466cdad4a5db0a9cd545b5ac954cd4e7b982aefc5e6c';

// Regex patterns
const EMAIL_PATTERN = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;
const PHONE_PATTERN = /(\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}/g;

// Helper Functions
function extractContactInfo(text) {
  const emails = [...new Set(text.match(EMAIL_PATTERN) || [])];
  const phones = [...new Set(text.match(PHONE_PATTERN) || [])];
  
  const filteredEmails = emails.filter(email => {
    const lower = email.toLowerCase();
    return !lower.includes('noreply') && 
           !lower.includes('support') && 
           !lower.includes('info@') &&
           !lower.includes('admin') &&
           !lower.includes('example') &&
           !lower.includes('test') &&
           !lower.includes('privacy') &&
           !lower.includes('abuse');
  });
  
  return {
    emails: filteredEmails.slice(0, 5),
    phones: phones.slice(0, 5)
  };
}

function cleanPhoneNumber(phone) {
  if (!phone) return '';
  // Remove all non-numeric characters
  return phone.replace(/\D/g, '');
}

function calculateConfidence(email, phone, source) {
  let score = 0;
  if (email) score += 50;
  if (phone) score += 40;
  if (source.includes('linkedin') || source.includes('realtor.com') || source.includes('zillow')) {
    score += 10;
  }
  return Math.min(score, 100);
}


async function searchSerpApiEnhanced(query, apiKey) {
  try {
    const response = await axios.get('https://serpapi.com/search.json', {
      params: {
        q: query,
        num: 20, 
        api_key: apiKey,
        hl: 'en',
        gl: 'us'
      },
      timeout: 15000
    });
    
    const results = [];
    const data = response.data;
    
    // Extract from organic results
    if (data.organic_results) {
      for (const result of data.organic_results) {
        results.push({
          url: result.link,
          title: result.title || '',
          snippet: result.snippet || '',
          type: 'organic'
        });
      }
    }
    

    if (data.knowledge_graph) {
      const kg = data.knowledge_graph;
      let kgText = [
        kg.title,
        kg.description,
        kg.phone,
        kg.email,
        JSON.stringify(kg.profiles),
        JSON.stringify(kg.contact)
      ].filter(Boolean).join(' ');
      
      results.push({
        url: kg.website || '',
        title: kg.title || '',
        snippet: kgText,
        type: 'knowledge_graph'
      });
    }
    
    // Extract from local results (business listings)
    if (data.local_results && data.local_results.places) {
      for (const place of data.local_results.places) {
        const placeText = [
          place.title,
          place.address,
          place.phone,
          place.website
        ].filter(Boolean).join(' ');
        
        results.push({
          url: place.website || '',
          title: place.title || '',
          snippet: placeText,
          type: 'local_business'
        });
      }
    }
    
    // Extract from answer box
    if (data.answer_box) {
      const ab = data.answer_box;
      const abText = [
        ab.answer,
        ab.title,
        ab.snippet
      ].filter(Boolean).join(' ');
      
      if (abText) {
        results.push({
          url: ab.link || '',
          title: ab.title || '',
          snippet: abText,
          type: 'answer_box'
        });
      }
    }
    
    return results;
  } catch (error) {
    console.error('SerpAPI error:', error.message);
    return [];
  }
}

// Try to scrape with fallback
async function tryScrapeSafe(url) {
  // Skip known blockers
  if (url.includes('linkedin.com') || 
      url.includes('zillow.com') || 
      url.includes('facebook.com')) {
    return null;
  }
  
  try {
    const response = await axios.get(url, {
      timeout: 8000,
      maxRedirects: 3,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept-Encoding': 'gzip, deflate, br',
        'DNT': '1',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      }
    });
    
    const $ = cheerio.load(response.data);
    $('script, style, noscript').remove();
    const text = $.text();
    
    return extractContactInfo(text);
  } catch (error) {
    // Silently fail - we'll rely on snippet data
    return null;
  }
}

// Main processing function - uses snippet data first, scraping as fallback
async function processRealtor(realtorData, apiKey) {
  const { firstName, lastName, company } = realtorData;
  
  // multiple search strategies
  const queries = [
    `${firstName} ${lastName} ${company} email phone contact`,
    `${firstName} ${lastName} ${company} email cell contact`,
    `${firstName} ${lastName} ${company} realtor contact`,
    `${firstName} ${lastName} realtor ${company}`,
    `"${firstName} ${lastName}" agent ${company}`
  ];
  
  const allContacts = {
    emails: [],
    phones: [],
    sources: []
  };
  
  try {
    // Try each search query
    for (const query of queries) {
      const searchResults = await searchSerpApiEnhanced(query, apiKey);
      
      // First pass: Extract from snippets (no scraping needed!)
      for (const result of searchResults) {
        const snippetContact = extractContactInfo(
          `${result.title} ${result.snippet}`
        );
        
        if (snippetContact.emails.length > 0 || snippetContact.phones.length > 0) {
          allContacts.emails.push(...snippetContact.emails);
          allContacts.phones.push(...snippetContact.phones);
          allContacts.sources.push(result.url || 'search_snippet');
        }
      }
      
      // If we found something, we can stop early
      if (allContacts.emails.length > 0 || allContacts.phones.length > 0) {
        break;
      }
      
      // Second pass: Try scraping safe URLs only
      for (const result of searchResults.slice(0, 5)) {
        if (!result.url) continue;
        
        const scrapedContact = await tryScrapeSafe(result.url);
        
        if (scrapedContact && (scrapedContact.emails.length > 0 || scrapedContact.phones.length > 0)) {
          allContacts.emails.push(...scrapedContact.emails);
          allContacts.phones.push(...scrapedContact.phones);
          allContacts.sources.push(result.url);
        }
        
        // Small delay between scrapes
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      
      // If we found something after scraping, stop
      if (allContacts.emails.length > 0 || allContacts.phones.length > 0) {
        break;
      }
      
      // Delay between different queries
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
    
    // Deduplicate and filter
    const uniqueEmails = [...new Set(allContacts.emails)];
    const uniquePhones = [...new Set(allContacts.phones)];
    
    const email = uniqueEmails[0] || '';
    const phone = uniquePhones[0] || '';
    const source = allContacts.sources[0] || '';
    const confidence = calculateConfidence(email, phone, source);
    
    return {
      firstName,
      lastName,
      company,
      email,
      phone: cleanPhoneNumber(phone),
      alternativeEmails: uniqueEmails.slice(1, 3),
      alternativePhones: uniquePhones.slice(1, 3).map(cleanPhoneNumber),
      source,
      confidence,
      companyAddress: realtorData.companyAddress || '',
      primaryZip: realtorData.primaryZip || '',
      primaryCity: realtorData.primaryCity || '',
      primaryStateCode: realtorData.primaryStateCode || '',
      tags: realtorData.tags || ''
    };
  } catch (error) {
    console.error(`Error processing ${firstName} ${lastName}:`, error.message);
    return {
      firstName,
      lastName,
      company,
      email: '',
      phone: '',
      alternativeEmails: [],
      alternativePhones: [],
      source: '',
      confidence: 0,
      companyAddress: realtorData.companyAddress || '',
      primaryZip: realtorData.primaryZip || '',
      primaryCity: realtorData.primaryCity || '',
      primaryStateCode: realtorData.primaryStateCode || '',
      tags: realtorData.tags || ''
    };

  }
}

// API Endpoints
app.post('/api/parse-csv', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const allRealtors = [];
    const needsScraping = [];
    const buffer = req.file.buffer.toString('utf-8');
    
    await new Promise((resolve, reject) => {
      Readable.from(buffer)
        .pipe(csv({ trim: true, skip_empty_lines: true }))
        .on('data', (row) => {
          const keys = Object.keys(row);
          
          const firstNameKey = keys.find(k => 
            k.toLowerCase().replace(/[_\s]/g, '') === 'firstname'
          );
          const lastNameKey = keys.find(k => 
            k.toLowerCase().replace(/[_\s]/g, '') === 'lastname'
          );
          const companyKey = keys.find(k => 
            k.toLowerCase() === 'company'
          );
          const emailKey = keys.find(k => 
            k.toLowerCase() === 'email'
          );
          const phoneKey = keys.find(k => 
            k.toLowerCase().includes('phone')
          );
          
          const firstName = (row[firstNameKey] || '').trim();
          const lastName = (row[lastNameKey] || '').trim();
          const company = (row[companyKey] || '').trim();
          const email = (row[emailKey] || '').trim();
          const phone = (row[phoneKey] || '').trim();
          const county = row.primary_city || '';
          const state = row.primary_state_code || '';
          let generatedTags = 'realtor';

          if (county && state) {
            generatedTags = `"${county}, ${state} realtor""${state} realtor""realtor"`;
          } else if (state) {
            generatedTags = `"${state} realtor""realtor"`;
          }
          
          const realtor = {
            firstName: row.first_name || row.firstName,
            lastName: row.last_name || row.lastName,
            company: row.company,
            email: row.email || '',
            phone: row.phone || '',
            companyAddress: row.company_address || '',
            primaryZip: row.primary_zip || '',
            primaryCity: row.primary_city || '',
            primaryStateCode: row.primary_state_code || '',
            tags: generatedTags
          };
          
          allRealtors.push(realtor);
          
          if (!email || !phone) {
            needsScraping.push(realtor);
          }
        })
        .on('end', resolve)
        .on('error', reject);
    });
    
    console.log(`Total realtors: ${allRealtors.length}`);
    console.log(`Need scraping: ${needsScraping.length}`);
    
    res.json({ 
      allRealtors,
      needsScraping,
      stats: {
        total: allRealtors.length,
        needsScraping: needsScraping.length,
        hasComplete: allRealtors.length - needsScraping.length
      }
    });
  } catch (error) {
    console.error('Parse error:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/scrape-realtor', async (req, res) => {
  try {
    console.log('Received scrape request:', req.body); 
    
    const { realtor } = req.body;

    if (!SERPAPI_KEY) {
      console.error('SERPAPI_KEY not found!'); 
      return res.status(500).json({ error: 'Server API key not configured' });
    }

    const apiKey = SERPAPI_KEY;
    console.log('Using API key:', apiKey.substring(0, 10) + '...'); 
    
    if (!realtor) {
      return res.status(400).json({ error: 'Realtor data is required' });
    }
    
    console.log('Processing realtor:', realtor); 
    const result = await processRealtor(realtor, apiKey);
    console.log('Result:', result); 
    res.json(result);
  } catch (error) {
    console.error('Scrape endpoint error:', error); 
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/scrape-batch', upload.single('file'), async (req, res) => {
  try {
    if (!SERPAPI_KEY) {
      return res.status(500).json({ error: 'Server API key not configured' });
    }

    const apiKey = SERPAPI_KEY;
        
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const allRealtors = [];
    const buffer = req.file.buffer.toString('utf-8');
    
    await new Promise((resolve, reject) => {
      Readable.from(buffer)
        .pipe(csv({ trim: true, skip_empty_lines: true }))
        .on('data', (row) => {
          const keys = Object.keys(row);
          
          const firstNameKey = keys.find(k => 
            k.toLowerCase().replace(/[_\s]/g, '') === 'firstname'
          );
          const lastNameKey = keys.find(k => 
            k.toLowerCase().replace(/[_\s]/g, '') === 'lastname'
          );
          const companyKey = keys.find(k => 
            k.toLowerCase() === 'company'
          );
          const emailKey = keys.find(k => 
            k.toLowerCase() === 'email'
          );
          const phoneKey = keys.find(k => 
            k.toLowerCase().includes('phone')
          );
          
          const firstName = (row[firstNameKey] || '').trim();
          const lastName = (row[lastNameKey] || '').trim();
          const company = (row[companyKey] || '').trim();
          const email = (row[emailKey] || '').trim();
          const phone = (row[phoneKey] || '').trim();
          
          allRealtors.push({
            firstName,
            lastName,
            company,
            email,
            phone,
            source: '',
            confidence: 0,
            needsScraping: !email || !phone
          });
        })
        .on('end', resolve)
        .on('error', reject);
    });
    
    const results = [...allRealtors];
    
    for (let i = 0; i < results.length; i++) {
      if (results[i].needsScraping) {
        console.log(`Processing ${i + 1}/${results.length}: ${results[i].firstName} ${results[i].lastName}`);
        
        const scrapedData = await processRealtor(results[i], apiKey);
        
        results[i] = {
          ...results[i],
          email: scrapedData.email || results[i].email,
          phone: scrapedData.phone || results[i].phone,
          alternativeEmails: scrapedData.alternativeEmails || [],
          alternativePhones: scrapedData.alternativePhones || [],
          source: scrapedData.source || results[i].source,
          confidence: scrapedData.confidence || 0
        };
        
        // Delaying between processing each realtor
        await new Promise(resolve => setTimeout(resolve, 3000));
      }
    }
    
    res.json({ results });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});