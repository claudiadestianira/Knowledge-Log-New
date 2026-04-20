/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import {createClient} from '@supabase/supabase-js';
import {GoogleGenAI} from "@google/genai";
import {AnimatePresence, motion} from 'motion/react';
import {
  Calendar,
  Clock,
  Edit3,
  Image as ImageIcon,
  Loader2,
  Plus,
  Search,
  Sparkles,
  Tag,
  Trash2,
  X,
  ChevronLeft,
  ChevronRight,
  SortAsc,
} from 'lucide-react';
import React, {useState, useEffect, useMemo, useRef} from 'react';

// --- Supabase Config (from user snippet) ---
const SUPABASE_URL = 'https://uabfxlxghsubaiifpxgl.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVhYmZ4bHhnaHN1YmFpaWZweGdsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2NTA4ODYsImV4cCI6MjA5MjIyNjg4Nn0.e2CcOYJD9LvVwTP7AIPD5uAOG44OMNb0zngYDPgFwTg';
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// --- Gemini AI Config ---
const ai = new GoogleGenAI({apiKey: process.env.GEMINI_API_KEY!});

interface JournalEntry {
  id: string;
  title: string;
  tags: string[];
  notes: string;
  date: string;
  image_urls: string[];
}

export default function App() {
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [sortMode, setSortMode] = useState<'date' | 'title'>('date');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<JournalEntry | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  
  // Form State
  const [fTitle, setFTitle] = useState('');
  const [fNotes, setFNotes] = useState('');
  const [fTags, setFTags] = useState('');
  const [fImages, setFImages] = useState<{dataUrl: string; name: string}[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [modalError, setModalError] = useState('');

  const [aiInsight, setAiInsight] = useState<string | null>(null);
  const [isAiLoading, setIsAiLoading] = useState(false);

  useEffect(() => {
    fetchEntries();

    // Setup real-time subscription
    const channel = supabase
      .channel('journal-sync')
      .on(
        'postgres_changes',
        {event: '*', schema: 'public', table: 'journal_entries'},
        (payload) => {
          console.log('Change received!', payload);
          // Refresh list on any change
          fetchEntries();
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  async function fetchEntries() {
    try {
      const {data, error} = await supabase
        .from('journal_entries')
        .select('*')
        .order('date', {ascending: false});
      
      if (error) throw error;
      setEntries(data || []);
    } catch (err: any) {
      console.error('Error fetching entries:', err.message);
    } finally {
      setLoading(false);
    }
  }

  const filteredEntries = useMemo(() => {
    let list = entries.filter((e) =>
      e.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      e.notes.toLowerCase().includes(searchTerm.toLowerCase()) ||
      e.tags.some((t) => t.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    if (sortMode === 'title') {
      return [...list].sort((a, b) => a.title.localeCompare(b.title));
    }
    return list;
  }, [entries, searchTerm, sortMode]);

  function openModal(entry?: JournalEntry) {
    if (entry) {
      setEditingEntry(entry);
      setFTitle(entry.title);
      setFTags(entry.tags.join(', '));
      setFNotes(entry.notes);
      setFImages(entry.image_urls.map((url) => ({dataUrl: url, name: url.split('/').pop() || 'image'})));
    } else {
      setEditingEntry(null);
      setFTitle('');
      setFTags('');
      setFNotes('');
      setFImages([]);
    }
    setModalError('');
    setIsModalOpen(true);
  }

  function closeModal() {
    setIsModalOpen(false);
    setAiInsight(null);
  }

  async function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files || []) as File[];
    const MAX_SIZE = 10 * 1024 * 1024;

    for (const file of files) {
      if (file.size > MAX_SIZE) {
        setModalError(`"${file.name}" exceeds 10 MB — skipped.`);
        continue;
      }
      const reader = new FileReader();
      reader.onload = (ev) => {
        setFImages((prev) => [...prev, {dataUrl: ev.target?.result as string, name: file.name}]);
      };
      reader.readAsDataURL(file);
    }
    e.target.value = '';
  }

  async function uploadImagesToStorage(entryId: string, images: {dataUrl: string; name: string}[]) {
    const urls: string[] = [];
    for (const img of images) {
      if (!img.dataUrl.startsWith('data:')) {
        urls.push(img.dataUrl);
        continue;
      }

      // Supabase Storage expects Blob/File
  const blob = (await (await fetch(img.dataUrl)).blob()) as Blob;
      const ext = img.name.split('.').pop() || 'jpg';
      const path = `${entryId}/${Date.now()}_${Math.random().toString(36).substring(7)}.${ext}`;

      const {data, error} = await supabase.storage
        .from('journal-images')
        .upload(path, blob, {contentType: blob.type});

      if (error) throw error;
      
      const {data: {publicUrl}} = supabase.storage
        .from('journal-images')
        .getPublicUrl(path);
      
      urls.push(publicUrl);
    }
    return urls;
  }

  async function handleSave() {
    if (!fTitle.trim()) {
      setModalError('⚠ Please enter a title!');
      return;
    }

    setIsSaving(true);
    setModalError('');

    try {
      const entryId = editingEntry?.id || Math.random().toString(36).substring(7);
      const imageUrls = await uploadImagesToStorage(entryId, fImages);
      const tags = fTags.split(',').map((t) => t.trim()).filter(Boolean);

      const entryData = {
        title: fTitle,
        tags,
        notes: fNotes,
        image_urls: imageUrls,
        date: editingEntry?.date || new Date().toISOString(),
      };

      if (editingEntry) {
        const {error} = await supabase
          .from('journal_entries')
          .update(entryData)
          .eq('id', editingEntry.id);
        if (error) throw error;
      } else {
        const {error} = await supabase
          .from('journal_entries')
          .insert([entryData]);
        if (error) throw error;
      }

      await fetchEntries();
      closeModal();
    } catch (err: any) {
      setModalError('⚠ Save failed: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(id: string) {
    try {
      const {error} = await supabase.from('journal_entries').delete().eq('id', id);
      if (error) throw error;
      setEntries((prev) => prev.filter((e) => e.id !== id));
      setConfirmingDeleteId(null);
    } catch (err: any) {
      console.error('Delete failed:', err.message);
    }
  }

  async function generateAiInsight() {
    if (!fTitle && !fNotes) {
      setModalError('⚠ Add some title or notes first for AI to analyze!');
      return;
    }

    setIsAiLoading(true);
    setAiInsight(null);

    try {
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: `Given this journal entry title: "${fTitle}" and notes: "${fNotes}". 
        Provide a short "Curious Insight" or fact related to this knowledge. 
        Keep it to 2 sentences. Also suggest 3 meaningful tags separated by commas.
        Format: Insight: [Your Insight] | Tags: [Tag1, Tag2, Tag3]`,
      });

      const text = response.text;
      setAiInsight(text);
    } catch (err: any) {
      setModalError('AI failure: ' + err.message);
    } finally {
      setIsAiLoading(false);
    }
  }

  function applyAiTags() {
    if (!aiInsight) return;
    const tagMatch = aiInsight.match(/Tags:\s*(.*)/);
    if (tagMatch) {
      const suggestedTags = tagMatch[1];
      setFTags((prev) => prev ? `${prev}, ${suggestedTags}` : suggestedTags);
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-12 md:px-8">
      {/* Header */}
      <header className="text-center mb-12 relative pb-8 after:content-[''] after:absolute after:bottom-0 after:left-1/2 after:-translate-x-1/2 after:w-4/5 after:h-1 after:bg-[repeating-linear-gradient(90deg,theme(colors.border-pink)_0,theme(colors.border-pink)_8px,transparent_8px,transparent_16px)]">
        <motion.h1 
          initial={{opacity: 0, y: -20}}
          animate={{opacity: 1, y: 0}}
          className="text-2xl md:text-4xl text-ink drop-shadow-[3px_3px_0_theme(colors.border-pink)] tracking-widest leading-relaxed mb-4"
        >
          Knowledge Journal 💗
        </motion.h1>
        <p className="font-mono text-lg md:text-xl opacity-75 max-w-2xl mx-auto">
          An infinite chamber of curiosities that transcends conventional norms of learning
        </p>
      </header>

      {/* Toolbar */}
      <div className="flex flex-wrap justify-center gap-4 mb-8">
        <button onClick={() => openModal()} className="pixel-btn-accent flex items-center gap-2">
          <Plus size={14} /> New Entry
        </button>
        <button onClick={() => setSortMode('date')} className={`pixel-btn flex items-center gap-2 ${sortMode === 'date' ? 'bg-btn-hover' : ''}`}>
          <Clock size={14} /> Sort by Date
        </button>
        <button onClick={() => setSortMode('title')} className={`pixel-btn flex items-center gap-2 ${sortMode === 'title' ? 'bg-btn-hover' : ''}`}>
          <SortAsc size={14} /> Sort by Title
        </button>
      </div>

      {/* Search */}
      <div className="flex justify-center mb-12">
        <div className="relative w-full max-w-md">
          <input 
            type="text" 
            placeholder="Search entries..."
            className="pixel-input w-full pl-10 text-lg"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 opacity-50" size={18} />
        </div>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="flex justify-center py-24">
          <Loader2 className="animate-spin text-ink" size={48} />
        </div>
      ) : filteredEntries.length > 0 ? (
        <div className="columns-1 sm:columns-2 lg:columns-3 xl:columns-4 gap-6 space-y-6">
          {filteredEntries.map((entry) => (
            <EntryCard
              key={entry.id}
              entry={entry}
              onEdit={(e) => openModal(e)}
              onDelete={(id) => setConfirmingDeleteId(id)}
              isConfirmingDelete={confirmingDeleteId === entry.id}
              onConfirmDelete={() => handleDelete(entry.id)}
              onCancelDelete={() => setConfirmingDeleteId(null)}
            />
          ))}
        </div>
      ) : (
        <div className="text-center py-24 opacity-55">
          <div className="text-5xl mb-4">✨</div>
          <p className="text-2xl font-mono">Your journal is empty...<br/>Add your first entry!</p>
        </div>
      )}

      {/* Modal Overlay */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{opacity: 0}}
              animate={{opacity: 1}}
              exit={{opacity: 0}}
              onClick={closeModal}
              className="absolute inset-0 bg-ink/40 backdrop-blur-sm"
            />
            <motion.div 
              initial={{scale: 0.95, y: 20, opacity: 0}}
              animate={{scale: 1, y: 0, opacity: 1}}
              exit={{scale: 0.95, y: 20, opacity: 0}}
              className="relative w-full max-w-2xl bg-card border-4 border-ink shadow-[8px_8px_0_theme(colors.border-pink)] p-6 md:p-8 max-h-[90vh] overflow-y-auto"
            >
              <h2 className="text-sm tracking-widest leading-loose mb-6 drop-shadow-[2px_2px_0_theme(colors.border-pink)]">
                ✦ {editingEntry ? 'Edit Entry' : 'New Entry'}
              </h2>

              {modalError && (
                <div className="bg-danger/20 border-2 border-danger p-3 mb-4 text-sm font-mono text-red-800">
                  {modalError}
                </div>
              )}

              <div className="space-y-6">
                <div>
                  <label className="block font-pixel text-[8px] mb-2">ENTRY TITLE</label>
                  <input 
                    type="text" 
                    className="pixel-input w-full"
                    placeholder="What did you learn?"
                    value={fTitle}
                    onChange={(e) => setFTitle(e.target.value)}
                  />
                </div>

                <div>
                  <label className="block font-pixel text-[8px] mb-2">TAGS (comma separated)</label>
                  <input 
                    type="text" 
                    className="pixel-input w-full"
                    placeholder="e.g. science, history, art"
                    value={fTags}
                    onChange={(e) => setFTags(e.target.value)}
                  />
                </div>

                <div>
                  <div className="flex justify-between items-center mb-2">
                    <label className="block font-pixel text-[8px]">NOTES</label>
                    <button 
                      onClick={generateAiInsight}
                      disabled={isAiLoading}
                      className="text-[8px] font-pixel text-accent flex items-center gap-1 hover:opacity-80 disabled:opacity-50"
                    >
                      {isAiLoading ? <Loader2 size={10} className="animate-spin" /> : <Sparkles size={10} />}
                      Gemini Magic
                    </button>
                  </div>
                  <textarea 
                    className="pixel-input w-full min-h-[150px] resize-y"
                    placeholder="Write your thoughts, discoveries, insights..."
                    value={fNotes}
                    onChange={(e) => setFNotes(e.target.value)}
                  />
                </div>

                {aiInsight && (
                  <motion.div 
                    initial={{opacity: 0, x: -10}}
                    animate={{opacity: 1, x: 0}}
                    className="bg-bg p-4 border-2 border-accent relative"
                  >
                    <p className="text-sm italic mb-2 leading-relaxed">{aiInsight}</p>
                    <button onClick={applyAiTags} className="text-[8px] font-pixel text-accent underline">
                      Apply Suggested Tags
                    </button>
                  </motion.div>
                )}

                <div>
                  <label className="block font-pixel text-[8px] mb-2">IMAGES</label>
                  <div 
                    className="border-3 border-dashed border-border-pink p-8 text-center bg-bg hover:bg-bg-secondary transition-colors cursor-pointer mb-4"
                    onClick={() => document.getElementById('file-upload')?.click()}
                  >
                    <input 
                      id="file-upload" 
                      type="file" 
                      multiple 
                      accept="image/*" 
                      className="hidden" 
                      onChange={handleImageSelect}
                    />
                    <ImageIcon className="mx-auto mb-2 opacity-50" size={32} />
                    <p className="text-lg opacity-80 underline">Click to attach images</p>
                  </div>

                  {fImages.length > 0 && (
                    <div className="flex flex-wrap gap-2">
                      {fImages.map((img, idx) => (
                        <div key={idx} className="relative group w-20 h-20 border-2 border-ink overflow-hidden">
                          <img src={img.dataUrl} alt="preview" className="w-full h-full object-cover" />
                          <button 
                            onClick={() => setFImages(prev => prev.filter((_, i) => i !== idx))}
                            className="absolute top-0 right-0 bg-danger text-ink p-1 leading-none font-pixel text-[8px]"
                          >
                            <X size={10} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap gap-4 pt-4">
                  <button 
                    onClick={handleSave} 
                    disabled={isSaving}
                    className="pixel-btn min-w-[140px] flex items-center justify-center gap-2"
                  >
                    {isSaving ? <Loader2 size={12} className="animate-spin" /> : '💾 Save Entry'}
                  </button>
                  <button onClick={closeModal} className="pixel-btn-danger">✕ Cancel</button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function EntryCard({
  entry,
  onEdit,
  onDelete,
  isConfirmingDelete,
  onConfirmDelete,
  onCancelDelete,
}: {
  entry: JournalEntry;
  onEdit: (e: JournalEntry) => void;
  onDelete: (id: string) => void;
  isConfirmingDelete: boolean;
  onConfirmDelete: () => void;
  onCancelDelete: () => void;
  key?: string;
}) {
  const [currentImageIdx, setCurrentImageIdx] = useState(0);

  const nextImg = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentImageIdx((prev) => (prev + 1) % entry.image_urls.length);
  };
  const prevImg = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentImageIdx((prev) => (prev - 1 + entry.image_urls.length) % entry.image_urls.length);
  };

  return (
    <motion.div 
      layout
      initial={{opacity: 0, scale: 0.9}}
      animate={{opacity: 1, scale: 1}}
      className="pixel-card break-inside-avoid relative overflow-hidden"
    >
      <AnimatePresence>
        {isConfirmingDelete && (
          <motion.div 
            initial={{opacity: 0}}
            animate={{opacity: 1}}
            exit={{opacity: 0}}
            className="absolute inset-0 z-10 bg-bg/95 flex flex-col items-center justify-center p-6 text-center gap-4"
          >
            <p className="font-pixel text-[8px] leading-loose">Delete this entry?<br/>This cannot be undone.</p>
            <div className="flex gap-4">
              <button onClick={onConfirmDelete} className="pixel-btn-danger">🗑 Delete</button>
              <button onClick={onCancelDelete} className="pixel-btn">✕ Cancel</button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Slider */}
      {entry.image_urls.length > 0 && (
        <div className="relative h-48 bg-bg-secondary group overflow-hidden border-b-3 border-ink">
          <img 
            src={entry.image_urls[currentImageIdx]} 
            alt="entry" 
            className="w-full h-full object-cover"
          />
          {entry.image_urls.length > 1 && (
            <>
              <div className="absolute inset-y-0 left-0 flex items-center p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={prevImg} className="pixel-btn p-1 bg-card/80"><ChevronLeft size={12} /></button>
              </div>
              <div className="absolute inset-y-0 right-0 flex items-center p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={nextImg} className="pixel-btn p-1 bg-card/80"><ChevronRight size={12} /></button>
              </div>
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1">
                {entry.image_urls.map((_, i) => (
                  <div key={i} className={`w-2 h-2 border border-ink ${i === currentImageIdx ? 'bg-ink' : 'bg-border-pink'}`} />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      <div className="p-4">
        <h3 className="text-[10px] tracking-tight mb-2 uppercase break-words leading-tight">{entry.title}</h3>
        
        <div className="flex flex-wrap gap-1 mb-3">
          {entry.tags.map((tag, i) => (
            <span key={i} className="bg-bg-secondary px-2 py-0.5 text-xs border border-border-pink flex items-center gap-1">
              <Tag size={10} className="opacity-50" /> {tag}
            </span>
          ))}
        </div>

        <p className="text-base leading-relaxed line-clamp-4 whitespace-pre-wrap mb-4 opacity-90">
          {entry.notes}
        </p>

        <div className="flex items-center gap-2 text-xs opacity-50 mb-4 border-t border-dotted border-ink pt-2 italic">
          <Calendar size={12} /> {new Date(entry.date).toLocaleDateString('en-US', {month: 'short', day: 'numeric', year: 'numeric'})}
        </div>

        <div className="flex gap-2">
          <button onClick={() => onEdit(entry)} className="pixel-btn p-2 flex items-center gap-1 flex-1 justify-center">
            <Edit3 size={12} /> Edit
          </button>
          <button onClick={() => onDelete(entry.id)} className="pixel-btn-danger p-2 flex items-center gap-1 flex-1 justify-center">
            <Trash2 size={12} /> Delete
          </button>
        </div>
      </div>
    </motion.div>
  );
}
