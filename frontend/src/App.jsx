import React, { useState } from 'react';
import './App.css'
import RealtorScraper from './RealtorScraper';
import { BrowserRouter as Router, Routes, Route, useLocation } from 'react-router-dom';

function App() {

  return (
    <>
    <Router>
      <main>
        <Routes>
          <Route path="/" element={<RealtorScraper />} />
        </Routes>
      </main>
    </Router>
    </>
  )
}

export default App
