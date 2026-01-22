import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  Play, Pause, Square, Upload, Settings, BookOpen, 
  Volume2, FastForward, Rewind, FileText, X, 
  Bookmark, Sun, Moon, Type, ChevronLeft, ChevronRight,
  Smile, Mic
} from 'lucide-react';

/**
 * UTILITIES
 */

const splitIntoSentences = (text) => {
  if (!text) return [];
  const clean = text.replace(/\s+/g, ' ').trim();
  // Robust sentence splitting that respects common abbreviations
  const rawSentences = clean.match( /[^.!?]+[.!?]+["']?|[^.!?]+$/g ) || [clean];
  
  const merged = [];
  let temp = '';
  const abbrevs = new Set(['Mr.', 'Mrs.', 'Ms.', 'Dr.', 'Prof.', 'Fig.', 'Vol.', 'p.', 'pp.', 'No.', 'vs.', 'etc.', 'e.g.', 'i.e.']);
  
  rawSentences.forEach(s => {
    const trimmed = s.trim();
    if (!trimmed) return;
    temp += (temp ? ' ' : '') + trimmed;
    const lastWord = temp.split(' ').pop();
    
    if (abbrevs.has(lastWord)) return;
    if (temp.length < 3 && !temp.match(/[.!?]$/)) return;

    merged.push(temp);
    temp = '';
  });
  
  if (temp) merged.push(temp);
  return merged;
};

const CHUNK_SIZE = 100;

export default function App() {
  // --- STATE ---
  
  // Data
  const [allSentences, setAllSentences] = useState([]);
  const [sentences, setSentences] = useState([]); // Current chunk
  const [currentChunkIndex, setCurrentChunkIndex] = useState(0);
  
  // Playback
  const [globalSentenceIndex, setGlobalSentenceIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const isPlayingRef = useRef(false); // Critical for continuous playback callback logic
  
  // Settings
  const [voices, setVoices] = useState([]);
  const [selectedVoice, setSelectedVoice] = useState(null);
  
  // Mood / Audio Settings
  const [mood, setMood] = useState('lecturer'); // lecturer, excited, serious, soothing
  const [rate, setRate] = useState(1.0);
  const [pitch, setPitch] = useState(1.0);
  const [volume, setVolume] = useState(1.0);
  
  // UI State
  const [fileName, setFileName] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingProgress, setLoadingProgress] = useState(0);
  const [showSidebar, setShowSidebar] = useState(false);
  const [theme, setTheme] = useState('dark');
  const [fontSize, setFontSize] = useState(18);
  const [bookmarks, setBookmarks] = useState([]);
  
  // Refs
  const synth = useRef(window.speechSynthesis);
  const utteranceRef = useRef(null);
  const fileInputRef = useRef(null);
  const activeSentenceRef = useRef(null);
  const textContainerRef = useRef(null);

  // --- INITIALIZATION ---

  useEffect(() => {
    const loadVoices = () => {
      const availableVoices = synth.current.getVoices();
      setVoices(availableVoices);
      
      // Try to find a good default (Google US English often sounds best if available)
      const preferred = availableVoices.find(v => v.name.includes('Google US English') || v.name.includes('Natural'));
      if (preferred) setSelectedVoice(preferred.name);
      else if (availableVoices.length > 0) setSelectedVoice(availableVoices[0].name);
    };
    loadVoices();
    if (synth.current.onvoiceschanged !== undefined) {
      synth.current.onvoiceschanged = loadVoices;
    }
    
    const savedBookmarks = localStorage.getItem('studyVoiceBookmarks');
    if (savedBookmarks) setBookmarks(JSON.parse(savedBookmarks));
  }, []);

  // Sync isPlaying state with ref for callbacks
  useEffect(() => {
    isPlayingRef.current = isPlaying;
    if (!isPlaying) {
      synth.current.cancel();
    }
  }, [isPlaying]);

  // --- MOOD PRESETS ---
  useEffect(() => {
    switch (mood) {
      case 'excited':
        setRate(1.1);
        setPitch(1.2);
        break;
      case 'serious':
        setRate(0.9);
        setPitch(0.8);
        break;
      case 'soothing':
        setRate(0.8);
        setPitch(0.9);
        break;
      case 'lecturer':
      default:
        setRate(1.0);
        setPitch(1.0);
        break;
    }
  }, [mood]);

  // --- CHUNK & SCROLL MANAGEMENT ---
  
  useEffect(() => {
    if (allSentences.length === 0) return;
    
    const newChunkIndex = Math.floor(globalSentenceIndex / CHUNK_SIZE);
    
    if (newChunkIndex !== currentChunkIndex) {
      setCurrentChunkIndex(newChunkIndex);
      const start = newChunkIndex * CHUNK_SIZE;
      setSentences(allSentences.slice(start, start + CHUNK_SIZE));
    }
    
    if (fileName) {
       localStorage.setItem(`progress_${fileName}`, globalSentenceIndex);
    }
  }, [globalSentenceIndex, allSentences, fileName, currentChunkIndex]);

  useEffect(() => {
    if (activeSentenceRef.current) {
      activeSentenceRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [globalSentenceIndex, currentChunkIndex]);

  // --- AUDIO ENGINE ---

  const speakSentence = useCallback((index) => {
    // Safety check
    if (index >= allSentences.length) {
      setIsPlaying(false);
      return;
    }

    // Cancel current before starting new
    synth.current.cancel();

    const sentenceText = allSentences[index];
    const utterance = new SpeechSynthesisUtterance(sentenceText);

    if (selectedVoice) {
      utterance.voice = voices.find(v => v.name === selectedVoice);
    }
    
    utterance.rate = rate;
    utterance.pitch = pitch;
    utterance.volume = volume;

    // Smart Pacing: Longer pause for long paragraphs
    let delay = 50; 
    if (sentenceText.length > 150) delay = 400;
    else if (sentenceText.length > 50) delay = 150;

    utterance.onend = () => {
      // CRITICAL FIX: Use ref to check if we should continue
      // This ignores React's closure staleness
      if (isPlayingRef.current) {
        const nextIndex = index + 1;
        if (nextIndex < allSentences.length) {
          setGlobalSentenceIndex(nextIndex);
          setTimeout(() => speakSentence(nextIndex), delay);
        } else {
          setIsPlaying(false);
        }
      }
    };
    
    utterance.onerror = (e) => {
      console.error("Speech error", e);
      // Don't auto-stop on minor errors, try next
      if (isPlayingRef.current) {
         // setIsPlaying(false); 
      }
    };

    utteranceRef.current = utterance;
    synth.current.speak(utterance);
    
  }, [allSentences, selectedVoice, rate, pitch, volume, voices]);

  const togglePlay = () => {
    if (isPlaying) {
      setIsPlaying(false);
      synth.current.cancel();
    } else {
      setIsPlaying(true);
      speakSentence(globalSentenceIndex);
    }
  };

  const stop = () => {
    setIsPlaying(false);
    synth.current.cancel();
  };

  const skip = (direction) => {
    const newIndex = direction === 'forward' 
      ? Math.min(allSentences.length - 1, globalSentenceIndex + 1)
      : Math.max(0, globalSentenceIndex - 1);
    
    setGlobalSentenceIndex(newIndex);
    if (isPlaying) {
      // If playing, immediately speak the new index
      // We rely on the useEffect(isPlaying) or direct call?
      // Direct call is safer for immediate feedback
      speakSentence(newIndex);
    }
  };


  // --- FILE HANDLING ---

  const handleFileUpload = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    setLoading(true);
    setLoadingProgress(0);
    stop();
    setFileName(file.name);
    setAllSentences([]);
    
    const savedIndex = localStorage.getItem(`progress_${file.name}`);
    const initialIndex = savedIndex ? parseInt(savedIndex) : 0;

    if (file.type === 'application/pdf') {
      try {
        await extractTextFromPDF(file, initialIndex);
      } catch (err) {
        alert('Error reading PDF. ' + err.message);
        setLoading(false);
      }
    } else {
      const reader = new FileReader();
      reader.onload = (e) => processText(e.target.result, initialIndex);
      reader.readAsText(file);
    }
  };

  const processText = (rawText, initialIndex) => {
    const split = splitIntoSentences(rawText);
    setAllSentences(split);
    
    const startChunk = Math.floor(initialIndex / CHUNK_SIZE);
    setCurrentChunkIndex(startChunk);
    setSentences(split.slice(startChunk * CHUNK_SIZE, (startChunk + 1) * CHUNK_SIZE));
    setGlobalSentenceIndex(initialIndex);
    
    setLoading(false);
  };

  const extractTextFromPDF = async (file, initialIndex) => {
    if (!window.pdfjsLib) {
      await loadScript('https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js');
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    
    let fullText = '';
    const totalPages = pdf.numPages;
    const batchSize = 10;
    
    const processBatch = async (startPage) => {
      let batchText = '';
      const endPage = Math.min(startPage + batchSize, totalPages + 1);
      
      for (let i = startPage; i < endPage; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        batchText += ` ` + textContent.items.map(item => item.str).join(' ');
      }
      
      fullText += batchText;
      setLoadingProgress(Math.round((endPage / totalPages) * 100));

      if (endPage <= totalPages) {
        setTimeout(() => processBatch(endPage), 10);
      } else {
        processText(fullText, initialIndex);
      }
    };

    processBatch(1);
  };

  const loadScript = (src) => {
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.onload = resolve;
      script.onerror = reject;
      document.body.appendChild(script);
    });
  };

  // --- FEATURES ---

  const addBookmark = () => {
    const newBookmark = {
      id: Date.now(),
      file: fileName,
      index: globalSentenceIndex,
      text: allSentences[globalSentenceIndex].substring(0, 50) + "...",
    };
    const updated = [...bookmarks, newBookmark];
    setBookmarks(updated);
    localStorage.setItem('studyVoiceBookmarks', JSON.stringify(updated));
  };

  const toggleTheme = () => {
    if (theme === 'dark') setTheme('light');
    else if (theme === 'light') setTheme('sepia');
    else setTheme('dark');
  };

  const getThemeColors = () => {
    switch(theme) {
      case 'light': return 'bg-gray-50 text-slate-900 selection:bg-yellow-200';
      case 'sepia': return 'bg-[#f4ecd8] text-[#5b4636] selection:bg-[#d6c6b0]';
      case 'dark': default: return 'bg-slate-900 text-slate-100 selection:bg-indigo-500 selection:text-white';
    }
  };
  
  const getHighlightColor = () => {
    switch(theme) {
      case 'light': return 'bg-yellow-200 ring-yellow-400 text-black';
      case 'sepia': return 'bg-[#dccaa0] ring-[#c1b49a] font-medium';
      case 'dark': default: return 'bg-indigo-500/30 text-indigo-100 ring-indigo-500/50';
    }
  };

  return (
    <div className={`h-screen w-screen flex flex-col font-sans transition-colors duration-300 overflow-hidden ${getThemeColors()}`}>
      
      {/* HEADER */}
      <header className={`px-4 py-3 flex justify-between items-center border-b z-20 shadow-sm transition-colors duration-300
        ${theme === 'dark' ? 'bg-slate-800 border-slate-700' : theme === 'sepia' ? 'bg-[#e9dec0] border-[#dccaa0]' : 'bg-white border-slate-200'}`}>
        
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center shadow-lg
            ${theme === 'dark' ? 'bg-gradient-to-br from-indigo-500 to-purple-600' : 'bg-indigo-500'}`}>
            <BookOpen className="text-white w-5 h-5" />
          </div>
          <div className="hidden md:block">
            <h1 className="text-lg font-bold leading-tight">StudyVoice Pro</h1>
            <p className="text-[10px] opacity-60 uppercase tracking-wider font-semibold">Continuous Flow Engine</p>
          </div>
        </div>

        <div className="flex items-center gap-2 md:gap-4">
          {fileName && (
            <div className={`hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium border
              ${theme === 'dark' ? 'bg-slate-900 border-slate-600' : 'bg-white/50 border-black/10'}`}>
              <FileText className="w-3 h-3 opacity-50" />
              <span className="truncate max-w-[150px]">{fileName}</span>
            </div>
          )}

          <input type="file" accept=".txt,.pdf" ref={fileInputRef} className="hidden" onChange={handleFileUpload} />
          <button 
             onClick={() => fileInputRef.current.click()}
             className={`p-2 rounded-lg transition-all active:scale-95 flex items-center gap-2 text-sm font-bold
             ${theme === 'dark' ? 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg shadow-indigo-500/20' : 'bg-white hover:bg-gray-50 text-indigo-600 shadow-sm border border-gray-200'}`}>
             <Upload className="w-4 h-4" />
             <span className="hidden sm:inline">Upload</span>
          </button>

          <div className="h-6 w-px bg-current opacity-10 mx-1"></div>

          <button onClick={toggleTheme} className="p-2 rounded-full hover:bg-black/5 transition-transform" title="Toggle Theme">
            {theme === 'dark' ? <Moon className="w-5 h-5" /> : theme === 'sepia' ? <BookOpen className="w-5 h-5" /> : <Sun className="w-5 h-5" />}
          </button>
          
          <button onClick={() => setShowSidebar(!showSidebar)} className={`p-2 rounded-lg ${showSidebar ? 'bg-indigo-500 text-white' : 'hover:bg-black/5'}`}>
            <Settings className="w-5 h-5" />
          </button>
        </div>
      </header>

      {/* MAIN LAYOUT */}
      <div className="flex-1 flex overflow-hidden relative">
        
        {/* SIDEBAR */}
        <div className={`absolute right-0 top-0 h-full w-80 shadow-2xl transform transition-transform duration-300 z-30 overflow-y-auto border-l backdrop-blur-sm
           ${showSidebar ? 'translate-x-0' : 'translate-x-full'}
           ${theme === 'dark' ? 'bg-slate-800/95 border-slate-700' : theme === 'sepia' ? 'bg-[#f4ecd8]/95 border-[#d6c6b0]' : 'bg-white/95 border-gray-200'}
        `}>
          <div className="p-6 space-y-8">
            <div className="flex justify-between items-center">
              <h3 className="font-bold text-lg flex items-center gap-2"><Settings className="w-4 h-4"/> Settings</h3>
              <button onClick={() => setShowSidebar(false)}><X className="w-5 h-5 opacity-50 hover:opacity-100"/></button>
            </div>

            {/* MOOD SELECTOR */}
            <div className="space-y-3">
              <p className="text-xs font-bold uppercase opacity-50 tracking-wider">Voice Mood</p>
              <div className="grid grid-cols-2 gap-2">
                {[
                  {id: 'lecturer', label: 'Lecturer', icon: '👨‍🏫'}, 
                  {id: 'serious', label: 'Serious', icon: '⚖️'},
                  {id: 'excited', label: 'Excited', icon: '🔥'}, 
                  {id: 'soothing', label: 'Soothing', icon: '🍃'}
                ].map(m => (
                  <button 
                    key={m.id}
                    onClick={() => setMood(m.id)}
                    className={`p-2 rounded-lg text-sm font-medium border transition-all text-left flex items-center gap-2
                      ${mood === m.id 
                        ? 'border-indigo-500 bg-indigo-500/10 text-indigo-500' 
                        : theme === 'dark' ? 'border-slate-600 hover:bg-slate-700' : 'border-gray-300 hover:bg-gray-100'
                      }`}
                  >
                    <span>{m.icon}</span> {m.label}
                  </button>
                ))}
              </div>
            </div>

            {/* VOICE SELECTOR */}
            <div className="space-y-4">
              <p className="text-xs font-bold uppercase opacity-50 tracking-wider">Voice Selection</p>
              <div className="relative">
                <Mic className="absolute left-3 top-2.5 w-4 h-4 opacity-50" />
                <select 
                  value={selectedVoice || ''} 
                  onChange={(e) => setSelectedVoice(e.target.value)}
                  className={`w-full pl-9 pr-3 py-2 rounded-lg text-sm outline-none border appearance-none
                    ${theme === 'dark' ? 'bg-slate-900 border-slate-600 focus:border-indigo-500' : 'bg-white border-gray-300 focus:border-indigo-500'}`}
                >
                  <optgroup label="Suggested">
                     {voices.filter(v => v.name.includes("Google") || v.name.includes("Male") || v.name.includes("David")).map(v => (
                       <option key={v.name} value={v.name}>{v.name.replace(/Microsoft |Google /g, '')}</option>
                     ))}
                  </optgroup>
                  <optgroup label="All Voices">
                    {voices.map(v => (
                      <option key={v.name} value={v.name}>{v.name}</option>
                    ))}
                  </optgroup>
                </select>
              </div>

              {/* Sliders */}
              <div className="space-y-4 pt-2">
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                    <label>Speed</label>
                    <span className="opacity-60">{rate}x</span>
                  </div>
                  <input type="range" min="0.5" max="2.0" step="0.1" value={rate} onChange={(e) => setRate(parseFloat(e.target.value))} className="w-full accent-indigo-500 h-1.5 bg-current opacity-20 rounded-lg appearance-none cursor-pointer"/>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-xs">
                     <label>Pitch</label>
                     <span className="opacity-60">{pitch}</span>
                  </div>
                  <input type="range" min="0.5" max="1.5" step="0.1" value={pitch} onChange={(e) => setPitch(parseFloat(e.target.value))} className="w-full accent-indigo-500 h-1.5 bg-current opacity-20 rounded-lg appearance-none cursor-pointer"/>
                </div>
              </div>
            </div>

            <div className="space-y-4 pt-4 border-t border-current border-opacity-10">
              <p className="text-xs font-bold uppercase opacity-50 tracking-wider">Appearance</p>
              <div className="flex items-center gap-4">
                <Type className="w-4 h-4 opacity-50" />
                <input type="range" min="14" max="32" step="2" value={fontSize} onChange={(e) => setFontSize(parseInt(e.target.value))} className="w-full accent-indigo-500 h-1.5 bg-current opacity-20 rounded-lg appearance-none"/>
                <span className="text-xs w-8 text-right font-mono">{fontSize}</span>
              </div>
            </div>
            
            <div className="space-y-2 pt-4 border-t border-current border-opacity-10">
               <p className="text-xs font-bold uppercase opacity-50 tracking-wider">Bookmarks</p>
               {bookmarks.map(b => (
                 <div key={b.id} onClick={() => { setGlobalSentenceIndex(b.index); setShowSidebar(false); }} className={`p-2 text-xs rounded border cursor-pointer hover:opacity-100 opacity-70 ${theme === 'dark' ? 'border-slate-600 bg-slate-700' : 'border-gray-200 bg-gray-50'}`}>
                   {b.text}
                 </div>
               ))}
               {bookmarks.length === 0 && <p className="text-xs opacity-40">No bookmarks yet.</p>}
            </div>

          </div>
        </div>

        {/* READER AREA */}
        <div className="flex-1 flex flex-col items-center justify-center relative w-full">
          
          {loading ? (
            <div className="text-center space-y-6">
               <div className="relative w-20 h-20 mx-auto">
                 <div className="absolute inset-0 border-4 border-indigo-500/30 rounded-full"></div>
                 <div className="absolute inset-0 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                 <BookOpen className="absolute inset-0 m-auto w-8 h-8 text-indigo-500" />
               </div>
               <div>
                 <h3 className="text-xl font-bold">Importing Text...</h3>
                 <p className="opacity-60 mt-1">Found {loadingProgress}% of pages</p>
               </div>
            </div>
          ) : allSentences.length > 0 ? (
            <>
              {/* Text Surface */}
              <div 
                ref={textContainerRef}
                className="flex-1 w-full max-w-4xl px-6 md:px-16 py-10 overflow-y-auto scroll-smooth"
                style={{ fontSize: `${fontSize}px`, lineHeight: '1.8' }}
              >
                {/* Chunk Navigation - Top */}
                <div className="flex justify-between items-center mb-10 opacity-40 text-xs uppercase font-bold tracking-widest hover:opacity-100 transition-opacity">
                   <button 
                     disabled={currentChunkIndex === 0} 
                     onClick={() => {stop(); setGlobalSentenceIndex((currentChunkIndex - 1) * CHUNK_SIZE)}} 
                     className="hover:text-indigo-500 disabled:opacity-20 flex items-center gap-1"
                   >
                    <ChevronLeft className="w-4 h-4" /> Prev Section
                  </button>
                  <span>Section {currentChunkIndex + 1} / {Math.ceil(allSentences.length / CHUNK_SIZE)}</span>
                  <button 
                    disabled={(currentChunkIndex + 1) * CHUNK_SIZE >= allSentences.length} 
                    onClick={() => {stop(); setGlobalSentenceIndex((currentChunkIndex + 1) * CHUNK_SIZE)}} 
                    className="hover:text-indigo-500 disabled:opacity-20 flex items-center gap-1"
                  >
                    Next Section <ChevronRight className="w-4 h-4" />
                  </button>
                </div>

                <div className="pb-40">
                  {sentences.map((sentence, idx) => {
                    const actualIdx = (currentChunkIndex * CHUNK_SIZE) + idx;
                    const isActive = actualIdx === globalSentenceIndex;
                    // Check if this sentence looks like a header (short, capitalised)
                    const isHeader = sentence.length < 50 && sentence === sentence.toUpperCase() && sentence.length > 4;
                    
                    return (
                      <span 
                        key={actualIdx}
                        ref={isActive ? activeSentenceRef : null}
                        onClick={() => { stop(); setGlobalSentenceIndex(actualIdx); }}
                        className={`
                          inline-block rounded px-1.5 transition-all duration-200 mx-0.5 cursor-pointer
                          ${isActive ? `${getHighlightColor()} scale-[1.02] shadow-sm` : 'hover:bg-black/5 dark:hover:bg-white/5'}
                          ${isActive ? '' : 'opacity-80'}
                          ${isHeader ? 'block font-bold mt-8 mb-4 text-[1.25em] opacity-100 border-b border-current border-opacity-20 pb-1' : ''}
                        `}
                      >
                        {sentence}
                      </span>
                    );
                  })}
                </div>
              </div>
            </>
          ) : (
            <div className="text-center max-w-md px-6">
               <div className={`w-24 h-24 rounded-3xl flex items-center justify-center mx-auto mb-6 shadow-xl transform -rotate-6
                  ${theme === 'dark' ? 'bg-slate-800' : 'bg-white'}`}>
                 <BookOpen className="w-12 h-12 text-indigo-500" />
               </div>
               <h2 className="text-3xl font-bold mb-3">StudyVoice Pro</h2>
               <p className="mb-8 opacity-70 leading-relaxed">
                 Transform your textbooks into an engaging audio experience. 
                 Upload PDF or TXT files to start listening with continuous flow.
               </p>
               <button 
                 onClick={() => fileInputRef.current.click()} 
                 className="bg-indigo-600 text-white px-8 py-4 rounded-xl font-bold shadow-xl shadow-indigo-500/30 hover:bg-indigo-500 transition-all hover:scale-105 flex items-center gap-3 mx-auto"
               >
                 <Upload className="w-5 h-5" />
                 Upload Textbook
               </button>
            </div>
          )}
        </div>
      </div>

      {/* PLAYER FOOTER */}
      <div className={`border-t px-6 py-4 z-20 backdrop-blur-lg
        ${theme === 'dark' ? 'bg-slate-800/90 border-slate-700' : theme === 'sepia' ? 'bg-[#e9dec0]/90 border-[#dccaa0]' : 'bg-white/90 border-slate-200'}`}>
         <div className="max-w-3xl mx-auto w-full flex flex-col gap-4">
            
            {/* Scrubber */}
            <div className="flex items-center gap-4 text-xs font-mono opacity-60 font-medium">
               <span className="w-8 text-right">{Math.floor((globalSentenceIndex / (allSentences.length || 1)) * 100)}%</span>
               <div 
                 className="flex-1 h-2 bg-current bg-opacity-10 rounded-full relative cursor-pointer group overflow-hidden"
                 onClick={(e) => {
                    const r = e.currentTarget.getBoundingClientRect();
                    const p = (e.clientX - r.left) / r.width;
                    stop();
                    setGlobalSentenceIndex(Math.floor(p * allSentences.length));
                 }}
               >
                 <div className="absolute top-0 left-0 h-full bg-indigo-500 rounded-full transition-all" style={{width: `${(globalSentenceIndex / (allSentences.length || 1)) * 100}%`}}></div>
               </div>
               <span className="w-8">100%</span>
            </div>

            {/* Controls */}
            <div className="flex items-center justify-between md:justify-center md:gap-12">
               
               <div className="flex items-center gap-4">
                 <button onClick={addBookmark} className="p-2 rounded-full hover:bg-black/10 transition-colors group" title="Bookmark">
                   <Bookmark className="w-5 h-5 opacity-50 group-hover:text-indigo-500 group-hover:opacity-100" />
                 </button>
                 <button onClick={() => setFontSize(f => Math.max(12, f-2))} className="hidden md:block p-2 hover:bg-black/10 rounded-full"><span className="text-xs font-bold opacity-50">A-</span></button>
                 <button onClick={() => setFontSize(f => Math.min(48, f+2))} className="hidden md:block p-2 hover:bg-black/10 rounded-full"><span className="text-lg font-bold opacity-50">A+</span></button>
               </div>

               <div className="flex items-center gap-6">
                 <button onClick={() => skip('back')} className="p-3 hover:text-indigo-500 hover:bg-indigo-500/10 rounded-full transition-all">
                   <Rewind className="w-6 h-6 fill-current" />
                 </button>

                 <button 
                   onClick={togglePlay}
                   disabled={allSentences.length === 0}
                   className={`w-16 h-16 rounded-2xl flex items-center justify-center shadow-2xl transition-all hover:scale-105 active:scale-95 disabled:opacity-50 disabled:grayscale
                     ${isPlaying 
                       ? 'bg-white text-slate-900 border-2 border-indigo-100' 
                       : 'bg-indigo-600 text-white shadow-indigo-500/40'}`}
                 >
                   {isPlaying ? <Pause className="w-6 h-6 fill-current" /> : <Play className="w-8 h-8 fill-current ml-1" />}
                 </button>

                 <button onClick={() => skip('forward')} className="p-3 hover:text-indigo-500 hover:bg-indigo-500/10 rounded-full transition-all">
                   <FastForward className="w-6 h-6 fill-current" />
                 </button>
               </div>
               
               <div className="flex items-center gap-2 w-24 md:w-32">
                 <Volume2 className="w-4 h-4 opacity-40" />
                 <input type="range" min="0" max="1" step="0.1" value={volume} onChange={(e) => setVolume(parseFloat(e.target.value))} className="w-full h-1.5 bg-current opacity-10 rounded-lg appearance-none accent-indigo-500" />
               </div>
            </div>
         </div>
      </div>

    </div>
  );
}