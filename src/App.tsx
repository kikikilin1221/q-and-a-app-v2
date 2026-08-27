import { useState, useRef, useEffect } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  verticalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Rnd } from 'react-rnd'

// ★ ここから追加（本格的な辞書ベースの音節分割ライブラリ）
// @ts-ignore
import Hypher from 'hypher'
// @ts-ignore
import english from 'hyphenation.en-us'
const h = new Hypher(english);
// ★ ここまで

// ★ ここから追加（ローカル辞書・オフラインフォールバック用）
// APIの精度が低い単語や、絶対に間違えたくない単語はここに登録します。
// ここに登録された単語はAPI通信を行わず、即座にこのデータが使われます。（完全無料・商用フリー）
const localWordDict: Record<string, { p?: string, f?: string }> = {
  "apple": { p: "/ˈæp.əl/", f: "ap-ple" },
  "certain": { p: "/ˈsɝ.tən/", f: "cer-tain" },
  "she": { p: "/ʃi/", f: "she" },
  "is": { p: "/ɪz/", f: "is" },
  "dictionary": { p: "/ˈdɪk.ʃən.ɛɹ.i/", f: "dic-tion-ar-y" }
  // 今後、必要に応じてここに自由に単語データを追加できます
};

// ★ 追加：13万語収録のIPA辞書をローカルから読み込む機能
let globalIpaDict: Record<string, string> | null = null;
const loadIpaDict = async () => {
  if (globalIpaDict) return globalIpaDict;
  try {
    const res = await fetch('/ipa-dict.json');
    if (res.ok) {
      globalIpaDict = await res.json();
    } else {
      globalIpaDict = {};
    }
  } catch (e) {
    globalIpaDict = {};
  }
  return globalIpaDict;
};

// ★ 追加：正確な音節（シラブル）をIndexedDBに永久記憶・読み出しする機能
let globalSyllableDict: Record<string, string> | null = null;
const loadSyllableDict = async () => {
  if (globalSyllableDict) return globalSyllableDict;
  globalSyllableDict = await idb.get('kiokushiyo_syllables') || {};
  return globalSyllableDict as Record<string, string>; // ★追加: 絶対にnullじゃないことを明示
};
const saveSyllable = async (word: string, syllable: string) => {
  if (!globalSyllableDict) globalSyllableDict = {};
  globalSyllableDict[word] = syllable;
  await idb.set('kiokushiyo_syllables', globalSyllableDict);
};
// ★ ここまで

import { createClient, type Session } from '@supabase/supabase-js'

// ==========================================
// ★ ここに自分のURLとキーを貼り付けてください！
// ==========================================
const supabaseUrl = 'https://zemkdjmsnpzmvfkdwyrj.supabase.co'
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InplbWtkam1zbnB6bXZma2R3eXJqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYwNjAzNzcsImV4cCI6MjEwMTYzNjM3N30.g1sZbZT2qzUhaw8Rxj5RZ1jZfKpM0dGUmhsnG0ql9as'
const supabase = createClient(supabaseUrl, supabaseKey)
// ==========================================

// --- 型定義 ---
interface FloatingImage { id: string; src: string; x: number; y: number; width: number; height: number; pinned?: boolean }
interface StockImage { id: string; src: string; type?: 'image' | 'folder'; name?: string; parentId?: string | null; isOpen?: boolean }
interface Card { id: string; question: string; answer: string; qImages: FloatingImage[]; aImages: FloatingImage[]; fontSize: number }
type ItemType = 'file' | 'folder'
interface AppItem { id: string; type: ItemType; name: string; parentId: string | null; cards: Card[] }

interface WordItem { id: string; type: 'word' | 'folder'; text: string; bgColor: string; textColor: string; parentId: string | null; isOpen: boolean }

// --- ユーティリティ ---

// ★ ここから追加：大容量保存(IndexedDB)用のヘルパー機能
const idb = {
  dbPromise: null as Promise<IDBDatabase> | null,
  getDb() {
    if (!this.dbPromise) {
      this.dbPromise = new Promise((resolve, reject) => {
        const req = indexedDB.open('KiokushiyoDB', 1);
        req.onupgradeneeded = (e: any) => {
          e.target.result.createObjectStore('store');
        };
        req.onsuccess = (e: any) => resolve(e.target.result);
        req.onerror = () => reject(req.error);
      });
    }
    return this.dbPromise;
  },
  async get(key: string) {
    try {
      const db = await this.getDb();
      return new Promise<any>((resolve, reject) => {
        const tx = db.transaction('store', 'readonly');
        const req = tx.objectStore('store').get(key);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    } catch(e) { return null; }
  },
  async set(key: string, val: any) {
    try {
      const db = await this.getDb();
      return new Promise<void>((resolve, reject) => {
        const tx = db.transaction('store', 'readwrite');
        tx.objectStore('store').put(val, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch(e) {}
  }
};
// ★ ここまで

const renderLatex = (htmlString: string) => {
  if (!htmlString) return '';
  let parsed = htmlString;
  const cleanMath = (math: string) => {
    const temp = document.createElement('div');
    temp.innerHTML = math.replace(/<br\s*\/?>/gi, '\n');
    return temp.textContent || temp.innerText || "";
  };
  const renderMath = (math: string, displayMode: boolean) => {
    try {
      const pureMath = cleanMath(math);
      return katex.renderToString(pureMath, { displayMode, throwOnError: false });
    } catch {
      return math;
    }
  };
  parsed = parsed.replace(/\$\$([\s\S]*?)\$\$/g, (_, math) => renderMath(math, true));
  parsed = parsed.replace(/\\\[([\s\S]*?)\\\]/g, (_, math) => renderMath(math, true));
  parsed = parsed.replace(/\\\(([\s\S]*?)\\\)/g, (_, math) => renderMath(math, false));
  parsed = parsed.replace(/\$([^\$]*?)\$/g, (_, math) => renderMath(math, false));
  return parsed;
};

// --- サブコンポーネント群 ---
function TimerStopwatch() {
  const [mode, setMode] = useState<'stopwatch' | 'timer'>('stopwatch')
  const [time, setTime] = useState(0)
  const [isActive, setIsActive] = useState(false)
  const [inputMinutes, setInputMinutes] = useState(5)

  useEffect(() => {
    let interval: any = null
    if (isActive) {
      interval = setInterval(() => {
        setTime(prev => {
          if (mode === 'stopwatch') return prev + 1
          if (mode === 'timer' && prev > 0) return prev - 1
          setIsActive(false)
          return 0
        })
      }, 1000)
    } else { clearInterval(interval) }
    return () => clearInterval(interval)
  }, [isActive, mode])

  const toggleMode = () => { setIsActive(false); setMode(mode === 'stopwatch' ? 'timer' : 'stopwatch'); setTime(mode === 'stopwatch' ? inputMinutes * 60 : 0) }
  const handleStart = () => { if (mode === 'timer' && time === 0) setTime(inputMinutes * 60); setIsActive(!isActive) }
  const handleReset = () => { setIsActive(false); setTime(mode === 'timer' ? inputMinutes * 60 : 0) }
  const formatTime = (totalSeconds: number) => {
    const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0'); const s = (totalSeconds % 60).toString().padStart(2, '0')
    return `${m}:${s}`
  }

  return (
    <div style={{ backgroundColor: '#2d3748', color: 'white', padding: '15px 20px', borderRadius: '8px', marginBottom: '20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
        <span style={{ fontSize: '1.8rem', fontWeight: 'bold', fontFamily: 'monospace' }}>{formatTime(time)}</span>
        <span style={{ fontSize: '0.9rem', color: '#a0aec0' }}>{mode === 'stopwatch' ? '(ストップウォッチ)' : '(タイマー)'}</span>
      </div>
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
        {mode === 'timer' && !isActive && <input type="number" value={inputMinutes} onChange={(e) => { setInputMinutes(Number(e.target.value)); setTime(Number(e.target.value) * 60); }} style={{ width: '50px', padding: '4px', borderRadius: '4px', color: 'black' }} min="1" />}
        <button onClick={handleStart} style={{ padding: '6px 12px', borderRadius: '4px', border: 'none', backgroundColor: isActive ? '#e53e3e' : '#48bb78', color: 'white', cursor: 'pointer', fontWeight: 'bold' }}>{isActive ? '停止' : '開始'}</button>
        <button onClick={handleReset} style={{ padding: '6px 12px', borderRadius: '4px', border: 'none', backgroundColor: '#718096', color: 'white', cursor: 'pointer' }}>リセット</button>
        <button onClick={toggleMode} style={{ padding: '6px 12px', borderRadius: '4px', border: '1px solid white', backgroundColor: 'transparent', color: 'white', cursor: 'pointer' }}>切替</button>
      </div>
    </div>
  )
}

function RichToolbar() {
  const handleFormat = (e: React.MouseEvent, command: string, value?: string) => {
    e.preventDefault();
    if (command === 'doubleUnderline') {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const range = sel.getRangeAt(0);
        const span = document.createElement('span');
        // ★ 文字の上に重なる黒の二重線（取り消し線ベース）
        span.style.textDecoration = 'line-through double black';
        // ★ 元のHTML構造（色や太字など）を維持したまま要素を移動させる
        span.appendChild(range.extractContents());
        range.insertNode(span);
        sel.removeAllRanges();
      }
    } else { document.execCommand(command, false, value); }
  };
  return (
    <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', opacity: 1, pointerEvents: 'auto', alignItems: 'center', backgroundColor: '#f7fafc', padding: '6px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
      <button onMouseDown={(e) => handleFormat(e, 'bold')} style={miniBtnStyle}>太字</button>
      <button onMouseDown={(e) => handleFormat(e, 'doubleUnderline')} style={miniBtnStyle}>二重線</button>
      <div style={{ display: 'flex', gap: '4px', alignItems: 'center', marginLeft: '10px' }}>
        <span style={{ fontSize: '0.8rem', fontWeight: 'bold', color: '#2d3748' }}>色:</span>
        {['black', 'red', 'blue', 'green', '#e4d00a', '#8B4513'].map(c => <div key={c} onMouseDown={(e) => handleFormat(e, 'foreColor', c)} style={{ width: 18, height: 18, backgroundColor: c, cursor: 'pointer', border: '1px solid #ccc', borderRadius: '50%' }} title={c} />)}
        <input type="color" onChange={(e) => document.execCommand('foreColor', false, e.target.value)} style={{ width: 24, height: 24, padding: 0, border: 'none', cursor: 'pointer' }} />
      </div>
    </div>
  );
}

function SortableCard({ card, index, isTestMode, isEditMode, onDelete, onEdit, onCopy, isMobileView, isCardExpanded, onToggleExpand }: { card: Card, index: number, isTestMode: boolean, isEditMode: boolean, onDelete: (id: string) => void, onEdit: (c: Card) => void, onCopy: (q: string, a: string) => void, isMobileView: boolean, isCardExpanded: boolean, onToggleExpand: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isOver } = useSortable({ id: card.id })
  const [revealed, setRevealed] = useState(false)
  const [tempFontSize, setTempFontSize] = useState<number>(card.fontSize || 16)
  const [isAnswerMaximized, setIsAnswerMaximized] = useState(false) // ★ 追加: 解答枠の最大化用ステート

  useEffect(() => { setRevealed(!isTestMode) }, [isTestMode])
  useEffect(() => { 
    if (!isCardExpanded) {
      setTempFontSize(card.fontSize || 16);
      setIsAnswerMaximized(false); // ★ 縮小時に最大化もリセット
    }
  }, [isCardExpanded, card.fontSize])

  const baseStyle = { transform: isCardExpanded ? 'none' : CSS.Transform.toString(transform), transition: isCardExpanded ? 'none' : transition, border: isOver ? '3px dashed #3182ce' : '1px solid #e2e8f0', borderRadius: '8px', padding: '16px', backgroundColor: '#ffffff', boxShadow: isOver ? '0 4px 12px rgba(49, 130, 206, 0.3)' : '0 2px 4px rgba(0,0,0,0.05)', position: 'relative' as const, zIndex: 1, color: '#2d3748', ...((isMobileView && !isEditMode) ? { flex: '0 0 100%', scrollSnapAlign: 'center', boxSizing: 'border-box' as const, minWidth: '0' } : {}) }
  const cardContainerStyle = isCardExpanded ? {
    width: isMobileView ? '100vw' : '100%',
    height: '100vh',
    flex: isMobileView ? '0 0 100vw' : 'none',
    backgroundColor: '#fff',
    padding: isMobileView ? '10px' : '30px',
    display: 'flex',
    flexDirection: 'column' as const,
    boxSizing: 'border-box' as const,
    scrollSnapAlign: 'start',
    borderBottom: isMobileView ? 'none' : '1px solid #e2e8f0',
    borderRight: isMobileView ? '1px solid #e2e8f0' : 'none',
    overflowY: 'auto' as const,
    overflowX: 'hidden' as const
  } : baseStyle;

  const renderImages = (images: FloatingImage[]) => {
    return (
      <>{images.map(img => (
        <div key={img.id} style={{ position: 'absolute', left: img.x, top: img.y, width: img.width, height: img.height, zIndex: 10 }}>
          <img src={img.src} style={{ width: '100%', height: '100%', borderRadius: '4px', pointerEvents: 'none' }} alt="" />
        </div>
      ))}</>
    )
  }

  return (
    <div ref={setNodeRef} style={cardContainerStyle}>
      {isEditMode && !isCardExpanded && (
        <div {...attributes} {...listeners} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', borderBottom: '1px solid #eee', paddingBottom: '8px', cursor: 'grab' }}>
          <span style={{ fontSize: '0.85rem', color: '#666', fontWeight: 'bold' }}>⠿ ここをドラッグして並び替え</span>
          <button onClick={() => { if (window.confirm('本当にこのカードを削除しますか？')) onDelete(card.id); }} style={{ color: '#e53e3e', border: 'none', background: 'none', cursor: 'pointer', fontWeight: 'bold' }}>削除</button>
        </div>
      )}

      {/* ★ 統合された共通コントロールヘッダー */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', padding: isCardExpanded ? '15px' : '5px', backgroundColor: isCardExpanded ? '#edf2f7' : 'transparent', borderRadius: '8px', flexShrink: 0 }}>
        <h3 style={{ margin: 0, fontSize: '1.3rem', color: '#2b6cb0', fontWeight: 'bold' }}>
          Q{index}
        </h3>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px', flexWrap: 'wrap', marginLeft: 'auto' }}>
          {!isTestMode && (
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={() => onCopy(card.question, card.answer)} style={{ ...miniBtnStyle, backgroundColor: '#edf2f7', color: '#4a5568' }}>コピー</button>
              <button onClick={() => onEdit(card)} style={{ ...miniBtnStyle, backgroundColor: '#bee3f8', color: '#2b6cb0' }}>編集する</button>
              <button onClick={() => { if (window.confirm('本当にこのカードを削除しますか？')) onDelete(card.id); }} style={{ ...miniBtnStyle, backgroundColor: '#fed7d7', color: '#c53030', padding: '4px 10px' }}>✕</button>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.9rem', color: '#2d3748' }}>
            <label>文字サイズ:</label>
            <input type="range" min="5" max="32" value={tempFontSize} onChange={(e) => setTempFontSize(Number(e.target.value))} />
            <span>{tempFontSize}px</span>
          </div>
          <button onClick={onToggleExpand} style={expandBtnStyleBig}>
            {isCardExpanded ? '縮小 ⤡' : '全体を拡大 ⤢'}
          </button>
        </div>
      </div>

      {/* ★ QA本体 (拡大時は作成画面と同じレイアウト) */}
      <div style={{ display: isCardExpanded ? 'flex' : 'grid', gridTemplateColumns: !isCardExpanded ? (isMobileView ? 'minmax(0, 1fr)' : '390px 390px') : undefined, flexDirection: isCardExpanded && !isMobileView ? 'row' : (isMobileView ? 'column' : 'row'), gap: '20px', justifyContent: 'center', width: '100%', flex: isCardExpanded ? 1 : 'none' }}>
        
        {/* Q枠 (解答が最大化されている場合は非表示) */}
        <div style={{ display: isAnswerMaximized ? 'none' : 'flex', flex: (!isCardExpanded && isMobileView) ? 'none' : 1, flexDirection: 'column', border: '1px solid #cbd5e0', borderRadius: '6px', height: isCardExpanded ? '100%' : '250px', minHeight: isCardExpanded ? 0 : '250px', minWidth: 0, width: '100%', boxSizing: 'border-box' }}>
          <div style={{ padding: '8px 12px', backgroundColor: '#ebf8ff', borderBottom: '1px solid #cbd5e0', borderTopLeftRadius: '6px', borderTopRightRadius: '6px' }}>
            <strong style={{ color: '#2b6cb0', fontSize: '1rem' }}>問題</strong>
          </div>
          <div style={{ flex: 1, padding: '10px', position: 'relative', overflow: 'auto', fontSize: `${tempFontSize}px`, color: '#2d3748', textAlign: 'left', whiteSpace: 'pre' }}>
            {renderImages(card.qImages)}
            <div dangerouslySetInnerHTML={{ __html: renderLatex(card.question) }} className="rich-text-content" style={{ minWidth: 'max-content' }} />
          </div>
        </div>
        
        {/* A枠 */}
        <div style={{ flex: (!isCardExpanded && isMobileView) ? 'none' : 1, display: 'flex', flexDirection: 'column', border: '1px solid #cbd5e0', borderRadius: '6px', height: isCardExpanded ? '100%' : '250px', minHeight: isCardExpanded ? 0 : '250px', minWidth: 0, width: '100%', boxSizing: 'border-box', cursor: isTestMode ? 'pointer' : 'default' }} onClick={() => { if (isTestMode) setRevealed(!revealed) }}>
          <div style={{ padding: '8px 12px', backgroundColor: '#fff5f5', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #cbd5e0', borderTopLeftRadius: '6px', borderTopRightRadius: '6px' }}>
            <strong style={{ color: '#c53030', fontSize: '1rem' }}>解答 {isTestMode && <span style={{fontSize: '0.8rem', color: '#e53e3e', marginLeft: '10px'}}>(クリックで表示)</span>}</strong>
            {/* ★ 追加: さらに拡大ボタン (拡大時のみ表示) */}
            {isCardExpanded && (
              <button onClick={(e) => { e.stopPropagation(); setIsAnswerMaximized(!isAnswerMaximized); }} style={{ ...miniBtnStyle, backgroundColor: '#fed7d7', color: '#c53030' }}>
                {isAnswerMaximized ? '元に戻す' : 'さらに拡大 ⤢'}
              </button>
            )}
          </div>
          <div style={{ flex: 1, padding: '10px', position: 'relative', overflow: 'auto', fontSize: `${tempFontSize}px`, color: '#2d3748', textAlign: 'left', whiteSpace: 'pre' }}>
            <div style={{ opacity: (!revealed) ? 0 : 1, transition: 'opacity 0.2s', height: '100%', minWidth: 'max-content' }}>
              {renderImages(card.aImages)}
              <div dangerouslySetInnerHTML={{ __html: renderLatex(card.answer) }} className="rich-text-content" style={{ minWidth: 'max-content' }} />
            </div>
            {!revealed && <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', fontWeight: 'bold', color: '#a0aec0' }}>クリックで解答を表示</div>}
          </div>
        </div>

      </div>
    </div>
  )
}

// ==========================================
// メインアプリ
// ==========================================
export default function App() {
  // ★ ダークモード管理
  const [isDarkMode, setIsDarkMode] = useState(() => {
    return localStorage.getItem('kiokushiyo_theme') === 'dark';
  })

  // ★ 認証用のステート（3モード対応: login | signup | verify）
  const [session, setSession] = useState<Session | null>(null)
  const [authMode, setAuthMode] = useState<'login' | 'signup' | 'verify'>('login')
  const [email, setEmail] = useState('')
　const [password, setPassword] = useState('')
  const [authMessage, setAuthMessage] = useState('')
  const [isAuthLoading, setIsAuthLoading] = useState(true)

  const [currentScreen, setCurrentScreen] = useState<'room' | 'editor'>('room')
  const [items, setItems] = useState<AppItem[]>([])
  
  // ★ 追加: ローカル保存用のステート
  const [localItems, setLocalItems] = useState<AppItem[]>([])
  const [isLocalDataLoaded, setIsLocalDataLoaded] = useState(false)

  const [activeFileId, setActiveFileId] = useState<string | null>(null)
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [dragOverRoomId, setDragOverRoomId] = useState<string | null>(null)
  
  const [editingCardId, setEditingCardId] = useState<string | null>(null)
  const [copiedQA, setCopiedQA] = useState<{q: string, a: string} | null>(null); // ★ 追加：コピー機能用ステート
  const [isMobileView, setIsMobileView] = useState(window.innerWidth <= 768);
  const [selectionMode, setSelectionMode] = useState<'cloud' | 'local' | null>(null); // ★ 追加: 選択モード（どの部屋で選択中か）
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]); // ★ 追加: 選択された項目のIDリスト
  const [isGlobalCardsExpanded, setIsGlobalCardsExpanded] = useState(false); // ★ 追加

  useEffect(() => {
    const handleResize = () => setIsMobileView(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
  const [isTestMode, setIsTestMode] = useState(false)
  const [isEditMode, setIsEditMode] = useState(false)
  const [fontSize, setFontSize] = useState(16)

  const [qImages, setQImages] = useState<FloatingImage[]>([])
  const [aImages, setAImages] = useState<FloatingImage[]>([])
　const [selectedImgId, setSelectedImgId] = useState<string | null>(null)
  const [isExpanded, setIsExpanded] = useState(false); // ★ 全体拡大用に統合
  const [isAnswerMaximized, setIsAnswerMaximized] = useState(false); // ★ 追加: 解答をさらに拡大
  const [wordPanelSide, setWordPanelSide] = useState<'right' | 'left'>('right'); // ★ 単語枠の位置用
  
  const [stockImages, setStockImages] = useState<StockImage[]>([])
  const [tempCreateFontSize, setTempCreateFontSize] = useState<number>(16)
  
  const [isDataLoaded, setIsDataLoaded] = useState(false)

 // ★ ここから追加（ワード一覧枠用）
  const [showWordPanel, setShowWordPanel] = useState(false)
  const [wordItems, setWordItems] = useState<WordItem[]>([])
  const [isWordDeleteMode, setIsWordDeleteMode] = useState(false)
  const [newWordText, setNewWordText] = useState('') 
  const [dragOverWordId, setDragOverWordId] = useState<string | null>(null) 
  const lastRangeRef = useRef<Range | null>(null);
  const [isDraggingWord, setIsDraggingWord] = useState(false);
  
  const [isEnglishMode, setIsEnglishMode] = useState(false)
  const [engWord, setEngWord] = useState('')
  const [engPhonetic, setEngPhonetic] = useState('')
  const [engSuggestions, setEngSuggestions] = useState<string[]>([]) 

  // ★ ここから追加：ボックス内の英単語サジェスト用ステート
  const [boxSuggestions, setBoxSuggestions] = useState<string[]>([])
  const [suggestionPos, setSuggestionPos] = useState<{top: number, left: number} | null>(null)
  const [suggestionTarget, setSuggestionTarget] = useState<'engWord' | 'box' | null>(null) // ★ 統合用ターゲット
  const [typingWordInfo, setTypingWordInfo] = useState<{word: string, node: Node, startOffset: number, endOffset: number} | null>(null)
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState<number>(-1); 
  const suggestionContainerRef = useRef<HTMLDivElement>(null); 
  
  // ★ 候補リストが更新されたら選択インデックスをリセットする
  useEffect(() => {
    setSelectedSuggestionIndex(-1);
  }, [boxSuggestions, engSuggestions, suggestionTarget]);

  // ★ キーボードで選択が移動した際、見切れないように自動スクロールする処理
  useEffect(() => {
    if (suggestionContainerRef.current && selectedSuggestionIndex >= 0) {
      const container = suggestionContainerRef.current;
      const selectedEl = container.children[selectedSuggestionIndex] as HTMLElement;
      if (selectedEl) {
        const containerTop = container.scrollTop;
        const containerBottom = containerTop + container.clientHeight;
        const elTop = selectedEl.offsetTop;
        const elBottom = elTop + selectedEl.clientHeight;
        if (elTop < containerTop) {
          container.scrollTop = elTop;
        } else if (elBottom > containerBottom) {
          container.scrollTop = elBottom - container.clientHeight;
        }
      }
    }
  }, [selectedSuggestionIndex]);
  // ★ ここまで

  // ★ 一括選択用のステートとユーティリティ
  const [isWordBulkMode, setIsWordBulkMode] = useState(false)
  const [selectedWordIds, setSelectedWordIds] = useState<string[]>([])
  const [lastClickedWordId, setLastClickedWordId] = useState<string | null>(null)

  // ★ 英単語モード入力欄の予測変換（サジェスト）を取得する処理
  useEffect(() => {
    if (!isEnglishMode || !engWord.trim()) {
      setEngSuggestions([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`https://api.datamuse.com/sug?s=${engWord.trim()}`);
        if (res.ok) {
          const data = await res.json();
          setEngSuggestions(data.map((d: any) => d.word));
        }
      } catch (e) {}
    }, 300); 
    return () => clearTimeout(timer);
  }, [engWord, isEnglishMode]);

  // ★ ボックス入力中の予測変換（サジェスト）を取得する処理
  useEffect(() => {
    if (!typingWordInfo || !typingWordInfo.word) {
      setBoxSuggestions([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`https://api.datamuse.com/sug?s=${typingWordInfo.word}`);
        if (res.ok) {
          const data = await res.json();
          setBoxSuggestions(data.map((d: any) => d.word));
        }
      } catch (e) {}
    }, 300);
    return () => clearTimeout(timer);
  }, [typingWordInfo?.word]);

  // 開いているフォルダを展開した「見た目順」のIDリストを取得する（範囲選択用）
  const getFlattenedVisibleWordIds = (parentId: string | null = null): string[] => {
    let result: string[] = [];
    const children = wordItems.filter(w => w.parentId === parentId);
    for (const child of children) {
      result.push(child.id);
      if (child.type === 'folder' && child.isOpen) {
        result = result.concat(getFlattenedVisibleWordIds(child.id));
      }
    }
    return result;
  };

  const handleInsertWord = (word: WordItem) => {
    const activeEl = document.activeElement as HTMLInputElement;
    if (activeEl && activeEl.tagName === 'INPUT' && activeEl.type === 'text') {
      const start = activeEl.selectionStart || 0;
      const end = activeEl.selectionEnd || 0;
      const val = activeEl.value;
      const textToInsert = word.text;
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      nativeInputValueSetter?.call(activeEl, val.slice(0, start) + textToInsert + val.slice(end));
      activeEl.dispatchEvent(new Event('input', { bubbles: true }));
      setTimeout(() => {
        activeEl.setSelectionRange(start + textToInsert.length, start + textToInsert.length);
        activeEl.focus();
      }, 0);
      return;
    }

    // ★ カーソルが外れている場合、最後に記憶した位置を復元し、強制的にフォーカスを当てる
    if (lastRangeRef.current) {
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(lastRangeRef.current);
      
      if (questionRef.current?.contains(lastRangeRef.current.commonAncestorContainer)) {
        questionRef.current.focus();
      } else if (answerRef.current?.contains(lastRangeRef.current.commonAncestorContainer)) {
        answerRef.current.focus();
      }
    }

    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      
      // ★ QAボックス内にカーソルがあるか最終確認
      if (!questionRef.current?.contains(range.commonAncestorContainer) && !answerRef.current?.contains(range.commonAncestorContainer)) {
        return; // QAボックス外なら挿入しない
      }

      range.deleteContents();
      const span = document.createElement('span');
      span.style.backgroundColor = word.bgColor;
      span.style.color = word.textColor;
      span.style.padding = '1px 4px';
      span.style.borderRadius = '4px';
      span.style.margin = '0 2px';
      span.contentEditable = "false";
      span.textContent = word.text;
      
      // ★ フラグメントを使って「ゼロ幅スペース」→「単語」→「ゼロ幅スペース」の順で確実に挿入する
      const frag = document.createDocumentFragment();
      frag.appendChild(document.createTextNode('\u200B')); // 前のゼロ幅スペース
      frag.appendChild(span);
      const zwsAfter = document.createTextNode('\u200B'); // 後のゼロ幅スペース
      frag.appendChild(zwsAfter);
      
      range.insertNode(frag);
      // ★ カーソルを「後のゼロ幅スペース」の直後に置くことでIMEバグを回避
      range.setStartAfter(zwsAfter);
      range.collapse(true); 
      
      sel.removeAllRanges();
      sel.addRange(range);
      lastRangeRef.current = range.cloneRange();
    }
  };

  // ※ 古い getCreateExpandedStyle は不要になったため削除

 // ★ ここから追加（ワード色変更・パレット用）
  const [editingWordId, setEditingWordId] = useState<string | null>(null);
  const [savedColors, setSavedColors] = useState<{bg: string, text: string}[]>([
    { bg: '#bee3f8', text: '#2b6cb0' }, { bg: '#fed7d7', text: '#c53030' }, { bg: '#fefcbf', text: '#b7791f' }, 
  ]);
  const [isColorDeleteMode, setIsColorDeleteMode] = useState(false);
  const [tempBgColor, setTempBgColor] = useState('#ffffff');
  const [tempTextColor, setTempTextColor] = useState('#000000');

  // ★ ここから追加（隠しコマンド用）
  const [secretClicks, setSecretClicks] = useState(0);
  useEffect(() => {
    if (secretClicks > 0) {
      const timer = setTimeout(() => setSecretClicks(0), 1000);
      return () => clearTimeout(timer);
    }
  }, [secretClicks]);

  const handleSecretClick = () => {
    const newCount = secretClicks + 1;
    setSecretClicks(newCount);
    if (newCount >= 5) {
      const byteSize = new Blob([JSON.stringify(items)]).size;
      const mbSize = (byteSize / 1024 / 1024).toFixed(2);
      const percentage = ((Number(mbSize) / 500) * 100).toFixed(2);
      alert(`📊 【開発者モード：データ使用量】\n\n現在の総データサイズ: 約 ${mbSize} MB\n（無料枠 500MB のうち 約 ${percentage}% を使用中）\n\n※ストレージ容量は0GBです。`);
      setSecretClicks(0);
    }
  };

  const questionRef = useRef<HTMLDivElement>(null)
  const answerRef = useRef<HTMLDivElement>(null)
  
  // ★ 変更: クラウドかローカルのどちらかからアクティブなファイルを探す
  const activeFile = items.find(i => i.id === activeFileId && i.type === 'file') || localItems.find(i => i.id === activeFileId && i.type === 'file')
  
  // ★ 追加: 開いているファイルがどちらの部屋のものかを自動判定して更新する関数
  const updateActiveFile = (updater: (file: AppItem) => AppItem) => {
    if (items.some(i => i.id === activeFileId)) {
      setItems(items.map(i => i.id === activeFileId ? updater(i) : i));
    } else if (localItems.some(i => i.id === activeFileId)) {
      setLocalItems(localItems.map(i => i.id === activeFileId ? updater(i) : i));
    }
  };

  // 日本語IMEの変換（スペースキー）と確定（エンターキー）を阻害する KeyboardSensor を削除
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }))

  const appBgColor = isDarkMode ? '#1a202c' : '#f7fafc';
  const textColor = isDarkMode ? '#e2e8f0' : '#2d3748';

  useEffect(() => { localStorage.setItem('kiokushiyo_theme', isDarkMode ? 'dark' : 'light'); }, [isDarkMode])
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => { setSession(session); setIsAuthLoading(false) })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => { setSession(session) })
    return () => subscription.unsubscribe()
  }, [])
  useEffect(() => {
    const fetchCloudData = async () => {
      if (!session?.user?.id) return;
      try {
        const { data } = await supabase.from('user_store').select('items').eq('id', session.user.id).single();
        if (data && data.items) setItems(data.items);
      } catch (err) {} finally { setIsDataLoaded(true); }
    };
    if (session) fetchCloudData();
  }, [session]);
  useEffect(() => {
    if (!isDataLoaded || !session?.user?.id) return;
    const saveCloudData = async () => { await supabase.from('user_store').upsert({ id: session.user.id, items: items }); };
    saveCloudData();
  }, [items, isDataLoaded, session]);

  // ★ 変更: ローカル部屋・ワード・スクショ箱の大容量データ読み込み（IndexedDB + 自動移行処理）
  useEffect(() => {
    const loadData = async () => {
      // 1. ローカル部屋のデータ読み込み
      let lItems = await idb.get('kiokushiyo_local_room');
      if (!lItems) {
        // IndexedDBに無ければ、古いlocalStorageからデータを救出して移行する
        const saved = localStorage.getItem('kiokushiyo_local_room');
        if (saved) { lItems = JSON.parse(saved); await idb.set('kiokushiyo_local_room', lItems); }
      }
      if (lItems) setLocalItems(lItems);
      setIsLocalDataLoaded(true);

      // 2. ワード一覧のデータ読み込み
      let wItems = await idb.get('kiokushiyo_words');
      if (!wItems) {
        const saved = localStorage.getItem('kiokushiyo_words');
        if (saved) { wItems = JSON.parse(saved); await idb.set('kiokushiyo_words', wItems); }
      }
      if (wItems) setWordItems(wItems);

      // 3. スクショ箱のデータ読み込み
      let sImages = await idb.get('kiokushiyo_stock');
      if (!sImages) {
        const saved = localStorage.getItem('kiokushiyo_stock');
        if (saved) { sImages = JSON.parse(saved); await idb.set('kiokushiyo_stock', sImages); }
      }
      if (sImages) setStockImages(sImages);

      // 色パレットは非常に軽いため、今まで通りlocalStorageから読み込み
      const storedColors = localStorage.getItem('kiokushiyo_colors');
      if (storedColors) setSavedColors(JSON.parse(storedColors));
    };
    loadData();
  }, []);

  // ★ 変更: 各データが更新されたら、大容量のIndexedDBへ非同期で保存する
  useEffect(() => { 
    if (isLocalDataLoaded) idb.set('kiokushiyo_local_room', localItems); 
  }, [localItems, isLocalDataLoaded]);

  useEffect(() => { 
    if (isLocalDataLoaded) idb.set('kiokushiyo_words', wordItems); 
  }, [wordItems, isLocalDataLoaded]);

  useEffect(() => { 
    if (isLocalDataLoaded) idb.set('kiokushiyo_stock', stockImages); 
  }, [stockImages, isLocalDataLoaded]);

  useEffect(() => { 
    localStorage.setItem('kiokushiyo_colors', JSON.stringify(savedColors)); 
  }, [savedColors]);

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault(); setAuthMessage('処理中...');
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) { setAuthMessage(`エラー: ${error.message}`); } else { setAuthMessage('確認メールを送信しました！'); setAuthMode('login'); }
  };
  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault(); setAuthMessage('ログイン中...');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) { setAuthMessage(`ログイン失敗: ${error.message}`); } else { setAuthMessage(''); }
  };
  const handleSignOut = async () => { await supabase.auth.signOut(); setItems([]); setIsDataLoaded(false); setAuthMode('login'); };

  useEffect(() => { 
    if (!isExpanded) {
      setTempCreateFontSize(fontSize);
      setIsAnswerMaximized(false); // ★ 追加: 縮小時に解答拡大をリセット
    }
  }, [isExpanded, fontSize])

 // ★ クリック時とキーボード入力時のみ静かにカーソル位置を記憶（再描画なし）
  const saveCursorPosition = () => {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const r = sel.getRangeAt(0);
      if (questionRef.current?.contains(r.commonAncestorContainer) || answerRef.current?.contains(r.commonAncestorContainer)) {
        lastRangeRef.current = r.cloneRange();
      }
    }
  };

// ★ ボックス用サジェストをクリックして適用する処理
  const applyBoxSuggestion = (suggestion: string) => {
    if (!typingWordInfo) return;
    const { node, startOffset, endOffset } = typingWordInfo;
    const text = node.nodeValue || '';
    const newText = text.slice(0, startOffset) + suggestion + text.slice(endOffset);
    node.nodeValue = newText;

    // カーソルを挿入した単語の後ろに戻す
    const sel = window.getSelection();
    const newRange = document.createRange();
    const newCursorPos = startOffset + suggestion.length;
    try {
      newRange.setStart(node, newCursorPos);
      newRange.setEnd(node, newCursorPos);
      sel?.removeAllRanges();
      sel?.addRange(newRange);
    } catch(e) {}

    setSuggestionTarget(null);
    setSuggestionPos(null);
    setBoxSuggestions([]);
    setTypingWordInfo(null);
    setSelectedSuggestionIndex(-1);
    saveCursorPosition();
  };

  // ★ 変更：英単語入力欄用のキーボード操作（上下矢印で選択）
  const handleEngWordKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (suggestionTarget === 'engWord' && engSuggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedSuggestionIndex(prev => (prev + 1) % engSuggestions.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedSuggestionIndex(prev => (prev - 1 + engSuggestions.length) % engSuggestions.length);
      } else if (e.key === 'Enter') {
        if (selectedSuggestionIndex >= 0) {
          e.preventDefault();
          setEngWord(engSuggestions[selectedSuggestionIndex]);
          setSuggestionTarget(null);
          setSelectedSuggestionIndex(-1);
        }
      } else if (e.key === 'Escape') {
        setSuggestionTarget(null);
        setSelectedSuggestionIndex(-1);
      }
    }
  };

  // ★ 変更：キーボード（上下矢印・エンターキー）でQAボックスのサジェストを選択・確定する処理
  const handleBoxKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (suggestionTarget === 'box' && suggestionPos && boxSuggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedSuggestionIndex(prev => (prev + 1) % boxSuggestions.length);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedSuggestionIndex(prev => (prev - 1 + boxSuggestions.length) % boxSuggestions.length);
      } else if (e.key === 'Enter') {
        if (selectedSuggestionIndex >= 0) {
          e.preventDefault();
          applyBoxSuggestion(boxSuggestions[selectedSuggestionIndex]);
        }
      } else if (e.key === 'Escape') {
        setSuggestionTarget(null);
        setSelectedSuggestionIndex(-1);
      }
    }
  };

  // ★ ボックス入力時の総合処理（独立した「i」の変換＋カーソル記憶＋予測変換サジェスト）
  const handleBoxInput = () => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (range.startContainer.nodeType !== Node.TEXT_NODE) return;

    const textNode = range.startContainer;
    let originalText = textNode.nodeValue || '';
    let newText = originalText;
    const offset = range.startOffset;

    // --- ① 独立した「i」を「I」に変換 ---
    // ※文頭の自動大文字化処理は削除しました
    newText = newText.replace(/(^|[\s ])i(?=[\s .,?!;:\)\]}])/g, '$1I');

    if (newText !== originalText) {
      textNode.nodeValue = newText;
      try {
        range.setStart(textNode, offset);
        range.setEnd(textNode, offset);
        sel.removeAllRanges();
        sel.addRange(range);
      } catch(err) {}
    }

    // --- ② カーソル位置記憶 ---
    saveCursorPosition();

    // --- ③ 英単語の入力検知とサジェスト呼び出し ---
    const currentSel = window.getSelection();
    if (!currentSel || currentSel.rangeCount === 0) return;
    const currentRange = currentSel.getRangeAt(0);
    if (currentRange.startContainer.nodeType !== Node.TEXT_NODE) {
      setSuggestionTarget(null);
      return;
    }

    const text = currentRange.startContainer.nodeValue || '';
    const currentOffset = currentRange.startOffset;
    const textBeforeCursor = text.slice(0, currentOffset);
    // カーソルの直前にある英文字の連続を抽出
    const match = textBeforeCursor.match(/[a-zA-Z]+$/);

    if (match) {
      const word = match[0];
      if (word.length >= 2) { // 2文字以上入力したらサジェスト起動
        const rect = currentRange.getBoundingClientRect();
        // 入力中の文字の真下にポップアップを配置する
        setSuggestionPos({ top: rect.bottom + window.scrollY, left: rect.left + window.scrollX });
        setSuggestionTarget('box');
        setTypingWordInfo({ word, node: currentRange.startContainer, startOffset: currentOffset - word.length, endOffset: currentOffset });
      } else {
        setSuggestionTarget(null);
      }
    } else {
      setSuggestionTarget(null);
    }
  };

  const handleImageInsertFromData = (dataUrl: string, isQuestion: boolean) => {
    const img = new Image(); img.onload = () => {
      const MAX_WIDTH = 250; let w = img.width, h = img.height
      if (w > MAX_WIDTH) { h = Math.round((h * MAX_WIDTH) / w); w = MAX_WIDTH }
      const newImage: FloatingImage = { id: Date.now().toString(), src: dataUrl, x: 20, y: 20, width: w, height: h, pinned: false }
      if (isQuestion) setQImages(prev => [...prev, newImage]); else setAImages(prev => [...prev, newImage])
    }
    img.src = dataUrl
  }

  const handleStockFileDrop = (e: React.DragEvent) => {
    e.preventDefault(); const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      Array.from(files).forEach(file => { if (file.type.startsWith('image/')) { const reader = new FileReader(); reader.onload = (event) => { if (event.target?.result) setStockImages(prev => [...prev, { id: Date.now().toString() + Math.random(), src: event.target!.result as string }]); }; reader.readAsDataURL(file); } });
    }
  };

  const handleStockPaste = (e: React.ClipboardEvent) => {
    const clipItems = e.clipboardData?.items; if (!clipItems) return; let hasImage = false;
    for (let i = 0; i < clipItems.length; i++) {
      if (clipItems[i].type.indexOf('image') !== -1) {
        hasImage = true; const file = clipItems[i].getAsFile();
        if (file) { const reader = new FileReader(); reader.onload = (event) => { if (event.target?.result) setStockImages(prev => [...prev, { id: Date.now().toString(), src: event.target!.result as string }]); }; reader.readAsDataURL(file); }
      }
    }
    if (hasImage) e.preventDefault();
  }

  const handleDropFromStock = (e: React.DragEvent, isQuestion: boolean) => { const src = e.dataTransfer.getData('stockImage'); if (src) { e.preventDefault(); handleImageInsertFromData(src, isQuestion); } }
  const handleFloatingImageInsertBtn = (isQuestion: boolean) => {
    const input = document.createElement('input'); input.type = 'file'; input.accept = 'image/*';
    input.onchange = (e: any) => { const file = e.target.files[0]; if (file) { const reader = new FileReader(); reader.onload = (event) => { if (event.target?.result) handleImageInsertFromData(event.target.result as string, isQuestion) }; reader.readAsDataURL(file) } }
    input.click()
  }

  const handleImageKeyDown = (e: React.KeyboardEvent, imgId: string, isQuestion: boolean) => { if (e.key === 'Backspace' || e.key === 'Delete') { if (isQuestion) setQImages(prev => prev.filter(i => i.id !== imgId)); else setAImages(prev => prev.filter(i => i.id !== imgId)); setSelectedImgId(null) } }
  const togglePinNew = (imgId: string, isQ: boolean) => { if (isQ) setQImages(prev => prev.map(img => img.id === imgId ? { ...img, pinned: !img.pinned } : img)); else setAImages(prev => prev.map(img => img.id === imgId ? { ...img, pinned: !img.pinned } : img)); }

  const renderNewImages = (images: FloatingImage[], isQ: boolean) => {
    return (
      <>
        {images.map(img => {
          if (img.pinned) {
            return (
              <div key={img.id} style={{ position: 'absolute', left: img.x, top: img.y, width: img.width, height: img.height, zIndex: 10 }}>
                <button onClick={(e) => { e.stopPropagation(); togglePinNew(img.id, isQ) }} style={{ position: 'absolute', top: -25, right: 0, ...miniBtnStyle }}>動かす</button>
                <img src={img.src} style={{ width: '100%', height: '100%', borderRadius: '4px', pointerEvents: 'none' }} alt="" />
              </div>
            );
          } else {
            return (
              <Rnd key={img.id} lockAspectRatio={true} size={{ width: img.width, height: img.height }} position={{ x: img.x, y: img.y }} onDragStop={(_e, d) => isQ ? setQImages(prev => prev.map(i => i.id === img.id ? { ...i, x: d.x, y: d.y } : i)) : setAImages(prev => prev.map(i => i.id === img.id ? { ...i, x: d.x, y: d.y } : i))} onResizeStop={(_e, _dir, ref, _delta, pos) => isQ ? setQImages(prev => prev.map(i => i.id === img.id ? { ...i, width: parseInt(ref.style.width), height: parseInt(ref.style.height), ...pos } : i)) : setAImages(prev => prev.map(i => i.id === img.id ? { ...i, width: parseInt(ref.style.width), height: parseInt(ref.style.height), ...pos } : i))} tabIndex={0} onFocus={() => setSelectedImgId(img.id)} onBlur={() => setSelectedImgId(null)} onKeyDown={(e: any) => handleImageKeyDown(e, img.id, isQ)} style={{ border: selectedImgId === img.id ? '2px solid red' : '2px dashed #3182ce', zIndex: 11, outline: 'none' }}>
                <button onClick={(e) => { e.stopPropagation(); togglePinNew(img.id, isQ) }} style={{ position: 'absolute', top: -25, right: 0, ...miniBtnStyle }}>固定</button>
                <img src={img.src} style={{ width: '100%', height: '100%', pointerEvents: 'none' }} alt="" />
              </Rnd>
            );
          }
        })}
      </>
    )
  }

  // ==========================================
  // ★ 描画ルートコンテナ（テーマ適用）
  // ==========================================
  return (
    <div style={{ backgroundColor: appBgColor, color: textColor, minHeight: '100vh', padding: '1px', transition: 'background-color 0.3s' }}>
      
      {/* ★ 丸ゴシック体の読み込みとBGM設定を追加、およびリッチテキスト内の文字サイズ・フォント強制上書き */}
      <style>
        {`
          @import url('https://fonts.googleapis.com/css2?family=Zen+Maru+Gothic:wght@900&display=swap');
          
          /* QAボックス（エディタ・カード表示）自体のフォントをUDデジタル教科書体に指定 */
          .rich-text-content {
            font-family: "UD デジタル 教科書体 N-R", "UD デジタル 教科書体 NP-R", "UD Digital Kyokasho-tai", "UD Digital Kyokasho-tai N-R", sans-serif !important;
            line-height: 2.0; /* ★ 追加: 数式（分数やルート）が上下のテキストと被らないように行間を広めに確保する */
          }

          /* QAボックス内部の要素（spanなど）にも文字サイズとフォント設定を強制適用するが、
             ★修正: 繊細なサイズ計算が必要な「KaTeXの数式要素 (.katex とその中身)」は除外して保護する */
          .rich-text-content *:not(.katex):not(.katex *) {
            font-size: inherit !important;
            font-family: inherit !important;
          }
        `}
      </style>
      {!isAuthLoading && !session && <audio src="/music3.mp3" autoPlay loop hidden />}

      {/* --- ログイン・登録・OTP認証 画面 --- */}
      {isAuthLoading ? (
        <div style={{ padding: '40px', textAlign: 'center' }}>読み込み中...</div>
      ) : !session ? (
        <div style={{ maxWidth: '400px', margin: '80px auto', padding: '30px', backgroundColor: '#fff', borderRadius: '8px', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', fontFamily: '"Zen Maru Gothic", sans-serif' }}>
          <div style={{ textAlign: 'center', marginBottom: '30px' }}>
            {/* ★ ロゴの歪み修正 (objectFit: 'cover' を追加) */}
            <img src="/logo.jpg" alt="ロゴ" style={{ width: '80px', height: '80px', borderRadius: '16px', marginBottom: '10px', objectFit: 'cover' }} />
            <h1 style={{ color: isDarkMode ? '#ffffff' : '#2d3748', margin: 0, fontSize: '2.2rem', fontFamily: '"Zen Maru Gothic", sans-serif', fontWeight: 900 }}>キオクシヨ</h1>
          </div>
          
          <form onSubmit={authMode === 'login' ? handleSignIn : handleSignUp} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '5px', fontSize: '0.9rem', color: '#4a5568' }}>メールアドレス</label>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e0', boxSizing: 'border-box', color: '#2d3748' }} />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '5px', fontSize: '0.9rem', color: '#4a5568' }}>パスワード (6文字以上)</label>
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required style={{ width: '100%', padding: '10px', borderRadius: '6px', border: '1px solid #cbd5e0', boxSizing: 'border-box', color: '#2d3748' }} />
            </div>
            {authMessage && <div style={{ padding: '10px', backgroundColor: '#ebf8ff', color: '#2b6cb0', borderRadius: '6px', fontSize: '0.9rem', whiteSpace: 'pre-wrap' }}>{authMessage}</div>}
            <button type="submit" style={{ marginTop: '10px', padding: '12px', borderRadius: '6px', border: 'none', backgroundColor: '#3182ce', color: 'white', fontWeight: 'bold', cursor: 'pointer' }}>
              {authMode === 'login' ? 'ログインする' : '登録する'}
            </button>
          </form>
        </div>
      ) : 

      // --- 部屋（ルーム）画面 ---
      currentScreen === 'room' ? (
        <div style={{ maxWidth: '900px', margin: '40px auto', padding: '20px', fontFamily: '"Zen Maru Gothic", sans-serif' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '2px solid #e2e8f0', paddingBottom: '15px', marginBottom: '20px', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
              <img src="/logo.jpg" alt="ロゴ" onClick={handleSecretClick} style={{ width: '60px', height: '60px', borderRadius: '12px', objectFit: 'cover', cursor: 'pointer', userSelect: 'none' }} />
              <h1 style={{ color: isDarkMode ? '#ffffff' : '#2d3748', margin: 0, fontSize: '2.2rem', letterSpacing: '2px', fontFamily: '"Zen Maru Gothic", sans-serif', fontWeight: 900 }}>キオクシヨ</h1>
            </div>
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <button onClick={() => setIsDarkMode(!isDarkMode)} style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid #a0aec0', backgroundColor: isDarkMode ? '#2d3748' : '#fff', cursor: 'pointer', color: isDarkMode ? '#e2e8f0' : '#2d3748', fontWeight: 'bold' }}>
                {isDarkMode ? '☀️ ライトモード' : '🌙 ダークモード'}
              </button>
              <button onClick={handleSignOut} style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid #e2e8f0', backgroundColor: '#fff', cursor: 'pointer', color: '#e53e3e', fontWeight: 'bold' }}>ログアウト</button>
            </div>
          </div>
          
          {!isDataLoaded && <div style={{ padding: '10px', backgroundColor: '#e2e8f0', color: '#2d3748', borderRadius: '4px', marginBottom: '15px' }}>⏳ クラウドからデータを読み込み中...</div>}

          {/* ★ 部屋ごとの描画を共通化する関数 */}
          {(() => {
            const renderRoomSection = (title: string, bgColor: string, titleColor: string, targetItems: AppItem[], setTargetItems: any, listType: string, backupName: string) => {
              const renderTree = (parentId: string | null, level: number = 0) => {
                return targetItems.filter(i => i.parentId === parentId).map(item => (
                  <div key={item.id} style={{ marginLeft: level > 0 ? '24px' : '0', marginTop: '8px' }}>
                    <div draggable={editingItemId !== item.id} onDragStart={(e) => { e.dataTransfer.setData('itemId', item.id); e.dataTransfer.setData('listType', listType); e.stopPropagation() }} onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverRoomId(null); const draggedId = e.dataTransfer.getData('itemId'); const srcList = e.dataTransfer.getData('listType'); if(!draggedId || srcList !== listType || draggedId === item.id) return; let currentParent: string | null = item.id; while(currentParent){ if(currentParent === draggedId) return; currentParent = targetItems.find(i=>i.id === currentParent)?.parentId || null; } const draggedIndex = targetItems.findIndex(i => i.id === draggedId); const draggedItem = targetItems[draggedIndex]; const newItems = [...targetItems]; newItems.splice(draggedIndex, 1); const targetItem = newItems.find(i => i.id === item.id); if(targetItem){ draggedItem.parentId = targetItem.parentId; const targetIndex = newItems.findIndex(i => i.id === item.id); newItems.splice(targetIndex + 1, 0, draggedItem); } setTargetItems(newItems); }} onDragOver={(e) => { e.preventDefault(); setDragOverRoomId(`${listType}-${item.id}`) }} onDragLeave={() => setDragOverRoomId(null)} onClick={() => { 
                      if (selectionMode === listType) {
                        if (selectedItemIds.includes(item.id)) { setSelectedItemIds(selectedItemIds.filter(id => id !== item.id)); } 
                        else { setSelectedItemIds([...selectedItemIds, item.id]); }
                        return;
                      }
                      if (item.type === 'file' && editingItemId !== item.id) { setActiveFileId(item.id); setCurrentScreen('editor') } 
                    }} 
                      style={{ padding: '12px 16px', border: '1px solid #cbd5e0', borderRadius: '6px', 
                        backgroundColor: item.type === 'folder' ? '#edf2f7' : '#ffffff', color: '#2d3748', 
                        cursor: selectionMode === listType ? 'pointer' : (editingItemId === item.id ? 'text' : (item.type === 'file' ? 'pointer' : 'grab')), display: 'flex', alignItems: 'center', boxShadow: '0 1px 2px rgba(0,0,0,0.05)', fontWeight: item.type === 'folder' ? 'bold' : 'normal', borderBottom: dragOverRoomId === `${listType}-${item.id}` ? '3px solid #3182ce' : '1px solid #cbd5e0' }}>
                      
                      {selectionMode === listType && (
                        <input type="checkbox" checked={selectedItemIds.includes(item.id)} readOnly style={{ marginRight: '10px', transform: 'scale(1.3)', cursor: 'pointer' }} />
                      )}
                      <span style={{ marginRight: '8px', fontSize: '1.2rem' }}>{item.type === 'folder' ? '📁' : '📄'}</span>
                      {editingItemId === item.id ? <input autoFocus defaultValue={item.name} onBlur={(e) => { setTargetItems(targetItems.map(i => i.id === item.id ? { ...i, name: e.target.value } : i)); setEditingItemId(null) }} onKeyDown={(e) => { if (e.nativeEvent.isComposing) return; if (e.key === 'Enter') { setTargetItems(targetItems.map(i => i.id === item.id ? { ...i, name: e.currentTarget.value } : i)); setEditingItemId(null) } }} onClick={(e) => e.stopPropagation()} style={{ fontSize: '1rem', padding: '4px', borderRadius: '4px', border: '2px solid #3182ce', outline: 'none', color: '#2d3748' }} /> : <span onDoubleClick={(e) => { e.stopPropagation(); setEditingItemId(item.id) }} style={{ flexGrow: 1 }}>{item.name}</span>}
                    </div>
                    {item.type === 'folder' && <div style={{ borderLeft: '2px dashed #cbd5e0', marginLeft: '12px', paddingLeft: '4px' }}>{renderTree(item.id, level + 1)}<div onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverRoomId(null); const draggedId = e.dataTransfer.getData('itemId'); const srcList = e.dataTransfer.getData('listType'); if(!draggedId || srcList !== listType || draggedId === item.id) return; let currentParent: string | null = item.id; while(currentParent){ if(currentParent === draggedId) return; currentParent = targetItems.find(i=>i.id === currentParent)?.parentId || null; } const draggedIndex = targetItems.findIndex(i => i.id === draggedId); const draggedItem = targetItems[draggedIndex]; const newItems = [...targetItems]; newItems.splice(draggedIndex, 1); draggedItem.parentId = item.id; newItems.push(draggedItem); setTargetItems(newItems); }} onDragOver={(e) => { e.preventDefault(); setDragOverRoomId(`${listType}-empty-${item.id}`) }} onDragLeave={() => setDragOverRoomId(null)} style={{ padding: '8px', color: '#a0aec0', fontSize: '0.8rem', fontStyle: 'italic', borderBottom: dragOverRoomId === `${listType}-empty-${item.id}` ? '3px solid #3182ce' : 'none' }}>↓ ここにドロップしてフォルダの中に入れる</div></div>}
                  </div>
                ));
              };

              return (
                <div style={{ backgroundColor: isDarkMode ? '#2d3748' : bgColor, padding: '20px', borderRadius: '8px', border: `1px solid ${titleColor}`, marginBottom: '30px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', flexWrap: 'wrap', gap: '10px' }}>
                    <h2 style={{ margin: 0, fontSize: '1.4rem', color: isDarkMode ? '#e2e8f0' : titleColor }}>{title}</h2>
                    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                      {selectionMode === listType ? (
                        <>
                          <button onClick={() => {
                            if (selectedItemIds.length === 0) return alert('項目が選択されていません。');
                            const idsToBackup = new Set(selectedItemIds);
                            let currentSize = 0;
                            while (idsToBackup.size > currentSize) {
                              currentSize = idsToBackup.size;
                              targetItems.forEach(i => { if (i.parentId && idsToBackup.has(i.parentId)) idsToBackup.add(i.id); });
                            }
                            const itemsToExport = targetItems.filter(i => idsToBackup.has(i.id));
                            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(itemsToExport, null, 2));
                            const downloadAnchor = document.createElement('a');
                            downloadAnchor.setAttribute("href", dataStr);
                            downloadAnchor.setAttribute("download", `kiokushiyo_${backupName}_${new Date().toISOString().slice(0,10)}.json`);
                            document.body.appendChild(downloadAnchor);
                            downloadAnchor.click();
                            downloadAnchor.remove();
                            setSelectionMode(null);
                            setSelectedItemIds([]);
                          }} style={{ ...miniBtnStyle, backgroundColor: '#38a169', color: 'white', border: 'none' }}>📥 選択項目をバックアップ</button>
                          
                          <button onClick={() => {
                            if (selectedItemIds.length === 0) return alert('項目が選択されていません。');
                            if (window.confirm('本当に選択した項目（およびその中身）を削除しますか？')) {
                              const idsToDelete = new Set(selectedItemIds);
                              let currentSize = 0;
                              while (idsToDelete.size > currentSize) {
                                currentSize = idsToDelete.size;
                                targetItems.forEach(i => { if (i.parentId && idsToDelete.has(i.parentId)) idsToDelete.add(i.id); });
                              }
                              setTargetItems(targetItems.filter(i => !idsToDelete.has(i.id)));
                              setSelectionMode(null);
                              setSelectedItemIds([]);
                            }
                          }} style={{ ...miniBtnStyle, backgroundColor: '#e53e3e', color: 'white', border: 'none' }}>🗑 選択項目を削除</button>
                          
                          <button onClick={() => { setSelectionMode(null); setSelectedItemIds([]); }} style={miniBtnStyle}>キャンセル</button>
                        </>
                      ) : (
                        <>
                          <button onClick={() => setTargetItems([...targetItems, { id: `file-${Date.now()}`, type: 'file', name: '新規ファイル', parentId: null, cards: [] }])} style={miniBtnStyle}>＋ 新規ファイル</button>
                          <button onClick={() => setTargetItems([...targetItems, { id: `folder-${Date.now()}`, type: 'folder', name: '新規フォルダ', parentId: null, cards: [] }])} style={miniBtnStyle}>＋ 新規フォルダ</button>
                          
                          <button onClick={() => { setSelectionMode(listType as 'cloud' | 'local'); setSelectedItemIds([]); }} style={{ ...miniBtnStyle, backgroundColor: '#edf2f7' }}>☑️ 選択して操作</button>
                          
                          <label style={{ ...miniBtnStyle, backgroundColor: '#d69e2e', color: 'white', border: 'none', display: 'inline-flex', alignItems: 'center', cursor: 'pointer', margin: 0 }}>
                            📤 復元 (追加)
                            <input type="file" accept=".json" onChange={(e) => {
                              if (e.target.files && e.target.files[0]) {
                                const reader = new FileReader();
                                reader.onload = (event) => {
                                  try {
                                    const parsed = JSON.parse(event.target?.result as string);
                                    if (Array.isArray(parsed) && window.confirm(`選択したバックアップデータを現在の部屋に追加して復元しますか？`)) {
                                      // ★ IDの重複を防ぐために新しいIDを振り直し、階層関係を維持する
                                      const idMap = new Map();
                                      const newItems = parsed.map((item: any) => {
                                        const newId = item.type + '-' + Date.now() + '-' + Math.random().toString(36).substring(2, 9);
                                        idMap.set(item.id, newId);
                                        return { ...item, id: newId };
                                      });
                                      newItems.forEach((item: any) => {
                                        if (item.parentId && idMap.has(item.parentId)) {
                                          item.parentId = idMap.get(item.parentId);
                                        } else {
                                          // ★ 復元データ内に親が存在しないアイテムは、一番上の階層（ルート）に配置する
                                          item.parentId = null;
                                        }
                                      });
                                      // ★ 既存のデータ（prev）を消さずに、新しいデータ（newItems）を追加する
                                      setTargetItems((prev: AppItem[]) => [...prev, ...newItems]);
                                      alert('データの追加復元が完了しました！');
                                    }
                                  } catch { alert('正しいバックアップファイル（JSON）を選択してください。'); }
                                };
                                reader.readAsText(e.target.files[0]);
                              }
                              e.target.value = ''; 
                            }} style={{ display: 'none' }} />
                          </label>
                        </>
                      )}
                    </div>
                  </div>
                  
                  <div onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData('itemId'); const srcList = e.dataTransfer.getData('listType'); if(srcList === listType) { setTargetItems(targetItems.map(item => item.id === id ? { ...item, parentId: null } : item)); } setDragOverRoomId(null) }} onDragOver={(e) => e.preventDefault()} style={{ minHeight: '250px', backgroundColor: isDarkMode ? '#1a202c' : '#ffffff', padding: '15px', borderRadius: '6px', border: '1px dashed #cbd5e0' }}>
                    <div onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverRoomId(null); const draggedId = e.dataTransfer.getData('itemId'); const srcList = e.dataTransfer.getData('listType'); if(!draggedId || srcList !== listType)return; const draggedIndex = targetItems.findIndex(i => i.id === draggedId); const draggedItem = targetItems[draggedIndex]; const newItems = [...targetItems]; newItems.splice(draggedIndex, 1); draggedItem.parentId = null; newItems.unshift(draggedItem); setTargetItems(newItems); }} onDragOver={(e) => { e.preventDefault(); setDragOverRoomId(`${listType}-root-top`) }} onDragLeave={() => setDragOverRoomId(null)} style={{ padding: '8px', color: '#a0aec0', fontSize: '0.8rem', fontStyle: 'italic', borderBottom: dragOverRoomId === `${listType}-root-top` ? '3px solid #3182ce' : 'none' }}>↓ ここにドロップして一番上に移動</div>
                    {renderTree(null)}
                  </div>
                </div>
              );
            };

            return (
              <>
                {renderRoomSection('☁️ クラウド部屋 (Supabase)', '#ebf8ff', '#2b6cb0', items, setItems, 'cloud', 'cloud_backup')}
                {renderRoomSection('💻 ローカル部屋 (この端末のみ)', '#e6fffa', '#319795', localItems, setLocalItems, 'local', 'local_backup')}
              </>
            );
          })()}
        </div>
      ) :

      // --- エディタ画面 ---
      (
        <div style={{ maxWidth: isMobileView ? '430px' : '1400px', margin: '0 auto', padding: '20px', fontFamily: '"Zen Maru Gothic", sans-serif', transition: 'max-width 0.3s' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', gap: '10px', flexWrap: 'wrap' }}>
            <button onClick={() => setCurrentScreen('room')} style={{ ...btnStyle, backgroundColor: '#e2e8f0' }}>← 部屋に戻る</button>
            {editingItemId === activeFileId ? (
  <input autoFocus defaultValue={activeFile?.name} onBlur={(e) => { updateActiveFile(i => ({ ...i, name: e.target.value })); setEditingItemId(null) }} onKeyDown={(e) => { if (e.nativeEvent.isComposing) return; if (e.key === 'Enter') { updateActiveFile(i => ({ ...i, name: e.currentTarget.value })); setEditingItemId(null) } }} style={{ fontSize: '1.5rem', fontWeight: 900, padding: '4px', borderRadius: '4px', border: '2px solid #3182ce', outline: 'none', maxWidth: '200px', color: '#2d3748', fontFamily: '"Zen Maru Gothic", sans-serif' }} />
) : (
              <h1 onDoubleClick={() => setEditingItemId(activeFileId)} style={{ margin: 0, fontSize: '1.8rem', cursor: 'text', wordBreak: 'break-all', color: isDarkMode ? '#ffffff' : '#2d3748', fontFamily: '"Zen Maru Gothic", sans-serif', fontWeight: 900 }} title="ダブルクリックで名前を変更">{activeFile?.name}</h1>
            )}
            <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
              <button onClick={() => setIsMobileView(!isMobileView)} style={{ ...btnStyle, backgroundColor: isMobileView ? '#805ad5' : '#e2e8f0', color: isMobileView ? 'white' : '#2d3748' }}>{isMobileView ? '📱 スマホ画面' : '💻 PC画面'}</button>
              <button onClick={() => {setIsTestMode(!isTestMode); setIsEditMode(false);}} style={{ ...btnStyle, backgroundColor: isTestMode ? '#e53e3e' : '#319795', color: 'white' }}>{isTestMode ? '閲覧モードへ' : 'テストする'}</button>
              {!isTestMode && <button onClick={() => setIsEditMode(!isEditMode)} style={{ ...btnStyle, backgroundColor: isEditMode ? '#d69e2e' : '#4a5568', color: 'white' }}>{isEditMode ? '完了' : '並び替え'}</button>}
            </div>
          </div>

          {isTestMode && <TimerStopwatch />}

          <div style={{ display: 'flex', gap: '20px', alignItems: 'flex-start', flexDirection: isMobileView ? 'column' : 'row' }}>
            <div style={{ flex: 1, width: '100%', maxWidth: '100%' }}>
              
              {!isTestMode && (
                <div onPaste={handleStockPaste} onDrop={(e) => { e.preventDefault(); handleStockFileDrop(e); const stockId = e.dataTransfer.getData('stockId'); if(stockId){ const newStock = [...stockImages]; const idx = newStock.findIndex(s=>s.id===stockId); const item = newStock[idx]; newStock.splice(idx,1); item.parentId = null; newStock.push(item); setStockImages(newStock); } }} onDragOver={(e) => e.preventDefault()} tabIndex={0} style={{ width: '100%', boxSizing: 'border-box', backgroundColor: '#e2e8f0', color: '#2d3748', border: '2px dashed #a0aec0', borderRadius: '8px', padding: '15px', marginBottom: '20px', outline: 'none' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
                    <strong style={{ fontSize: '0.9rem' }}>スクショ箱 (ペースト・ドロップ)</strong>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={() => setStockImages([...stockImages, { id: `sfolder-${Date.now()}`, src: '', type: 'folder', name: '新規フォルダ', parentId: null, isOpen: false }])} style={miniBtnStyle}>📁 フォルダ</button>
                      <button onClick={() => { if(window.confirm('スクショ箱の画像をすべて削除しますか？')) setStockImages([]) }} style={{ ...miniBtnStyle, color: '#e53e3e' }}>一括削除</button>
                    </div>
                  </div>
                  
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', minHeight: '80px' }}>
                    {(() => {
                      const renderStockTree = (parentId: string | null) => {
                        const children = stockImages.filter(s => (s.parentId || null) === parentId);
                        if (children.length === 0 && parentId !== null) return null;
                        return (
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', paddingLeft: parentId ? '15px' : '0', borderLeft: parentId ? '2px dashed #a0aec0' : 'none', marginTop: parentId ? '5px' : '0', width: '100%' }}>
                            {children.map(img => (
                              <div key={img.id} style={{ display: 'flex', flexDirection: 'column', gap: '5px', width: img.type === 'folder' ? '100%' : 'auto' }}>
                                {img.type === 'folder' ? (
                                  <div
                                    draggable
                                    onDragStart={(e) => { e.dataTransfer.setData('stockId', img.id); e.stopPropagation(); }}
                                    onDrop={(e) => {
                                      e.preventDefault(); e.stopPropagation();
                                      const draggedId = e.dataTransfer.getData('stockId'); if (!draggedId || draggedId === img.id) return;
                                      const newStock = [...stockImages]; const draggedIndex = newStock.findIndex(w => w.id === draggedId);
                                      const draggedItem = newStock[draggedIndex]; newStock.splice(draggedIndex, 1);
                                      draggedItem.parentId = img.id; newStock.push(draggedItem); setStockImages(newStock);
                                    }}
                                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                    onDoubleClick={() => { const newName = prompt('フォルダ名', img.name); if (newName) setStockImages(stockImages.map(s => s.id === img.id ? { ...s, name: newName } : s)); }}
                                    onClick={() => setStockImages(stockImages.map(s => s.id === img.id ? { ...s, isOpen: !s.isOpen } : s))}
                                    style={{ padding: '8px 12px', backgroundColor: '#fff', borderRadius: '6px', cursor: 'pointer', border: '1px solid #cbd5e0', display: 'inline-flex', alignItems: 'center', gap: '8px', fontWeight: 'bold' }}
                                  >
                                    {img.isOpen ? '📂' : '📁'} {img.name}
                                    <button onClick={(e) => { e.stopPropagation(); setStockImages(stockImages.filter(x => x.id !== img.id)) }} style={{ marginLeft: 'auto', background: 'red', color: 'white', border: 'none', borderRadius: '50%', width: '18px', height: '18px', cursor: 'pointer', fontSize: '10px' }}>×</button>
                                  </div>
                                ) : (
                                  <div style={{ position: 'relative', width: '150px', flexShrink: 0, backgroundColor: '#fff', padding: '4px', borderRadius: '4px', boxShadow: '0 1px 2px rgba(0,0,0,0.1)' }}>
                                    <button onClick={() => setStockImages(s => s.filter(x => x.id !== img.id))} style={{ position: 'absolute', top: -5, right: -5, background: 'red', color: 'white', border: 'none', borderRadius: '50%', width: '20px', height: '20px', cursor: 'pointer', fontSize: '10px' }}>×</button>
                                    <img src={img.src} draggable onDragStart={(e) => { e.dataTransfer.setData('stockId', img.id); e.stopPropagation(); }} style={{ width: '100%', cursor: 'grab', borderRadius: '2px' }} alt="" />
                                  </div>
                                )}
                                {img.type === 'folder' && img.isOpen && renderStockTree(img.id)}
                              </div>
                            ))}
                          </div>
                        );
                      };
                      return renderStockTree(null);
                    })()}
                  </div>
                </div>
              )}

              {!isTestMode && (
                <div style={
                  isExpanded ? {
                    position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 10000,
                    backgroundColor: '#fff', padding: isMobileView ? '10px' : '30px', 
                    display: 'flex', flexDirection: 'column', boxSizing: 'border-box', overflowY: 'auto'
                  } : { 
                    backgroundColor: 'white', color: '#2d3748', padding: '20px', borderRadius: '8px', marginBottom: '30px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)', width: '100%', boxSizing: 'border-box' 
                  }
                }>
                  {/* ★ 共通コントロールヘッダー (拡大ボタンと文字サイズバーを1つに統合) */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', padding: isExpanded ? '15px' : '0', backgroundColor: isExpanded ? '#edf2f7' : 'transparent', borderRadius: '8px', flexShrink: 0 }}>
                    <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#4a5568', display: isExpanded && isMobileView ? 'none' : 'block' }}>{editingCardId ? 'カード編集' : '新規追加'}</h3>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '15px', flexWrap: 'wrap' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.9rem', color: '#2d3748' }}>
                        <label>共通文字サイズ:</label>
                        <input type="range" min="5" max="32" value={tempCreateFontSize} onChange={(e) => setTempCreateFontSize(Number(e.target.value))} />
                        <span>{tempCreateFontSize}px</span>
                      </div>
                      <button onClick={() => setIsExpanded(!isExpanded)} style={expandBtnStyleBig}>
                        {isExpanded ? '縮小 ⤡' : '全体を拡大 ⤢'}
                      </button>
                    </div>
                  </div>

                  {/* ★ ツールバーと単語枠ボタン */}
                  <div style={{ marginBottom: '15px', width: '100%', flexShrink: 0 }}>
                    <div style={{ display: 'flex', gap: '10px', marginBottom: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                      <RichToolbar />
                      <button onClick={() => setShowWordPanel(!showWordPanel)} style={{ ...btnStyle, backgroundColor: showWordPanel ? '#3182ce' : '#e2e8f0', color: showWordPanel ? 'white' : '#2d3748' }}>
                        {showWordPanel ? '単語枠を閉じる' : '🔤 単語枠を開く'}
                      </button>
                      <button onClick={() => setIsEnglishMode(!isEnglishMode)} style={{ ...btnStyle, backgroundColor: isEnglishMode ? '#805ad5' : '#e2e8f0', color: isEnglishMode ? 'white' : '#2d3748' }}>
                        {isEnglishMode ? '英単語モードをオフ' : '🇺🇸 英単語モード'}
                      </button>
                      {/* ★ 追加：コピーした内容の貼り付けボタン */}
                      <button onClick={() => {
                        if (copiedQA) {
                          if (questionRef.current) questionRef.current.innerHTML = copiedQA.q;
                          if (answerRef.current) answerRef.current.innerHTML = copiedQA.a;
                        } else {
                          alert('先に各カードの「コピー」ボタンを押して内容をコピーしてください。');
                        }
                      }} style={{ ...btnStyle, backgroundColor: '#fbd38d', color: '#744210' }}>
                        📋 貼り付け
                      </button>
                    </div>

                    {/* ★ 単語枠パネル */}
                    {showWordPanel && (
                      <div style={
                        isExpanded ? {
                          position: 'fixed' as const,
                          top: isMobileView ? (wordPanelSide === 'right' ? '50vh' : 0) : 0,
                          left: isMobileView ? 0 : (wordPanelSide === 'right' ? '50vw' : 0),
                          width: isMobileView ? '100vw' : '50vw',
                          height: isMobileView ? '50vh' : '100vh',
                          zIndex: 10001,
                          padding: '20px',
                          backgroundColor: 'rgba(247, 250, 252, 0.98)',
                          boxSizing: 'border-box' as const,
                          borderLeft: !isMobileView && wordPanelSide === 'right' ? '3px solid #3182ce' : 'none',
                          borderRight: !isMobileView && wordPanelSide === 'left' ? '3px solid #3182ce' : 'none',
                          borderTop: isMobileView && wordPanelSide === 'right' ? '3px solid #3182ce' : 'none',
                          borderBottom: isMobileView && wordPanelSide === 'left' ? '3px solid #3182ce' : 'none',
                          boxShadow: '0 4px 15px rgba(0,0,0,0.2)'
                        } : { 
                          width: '100%', backgroundColor: '#f7fafc', border: '2px solid #cbd5e0', borderRadius: '8px', padding: '15px', boxSizing: 'border-box' 
                        }
                      }>
                        {isExpanded && (
                          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px' }}>
                            <button onClick={() => setWordPanelSide(prev => prev === 'right' ? 'left' : 'right')} style={{...btnStyle, backgroundColor: '#ebf8ff', color: '#2b6cb0', borderColor: '#2b6cb0'}}>🔄 反対側へ移動する</button>
                            <button onClick={() => setShowWordPanel(false)} style={btnStyle}>✖ 閉じる</button>
                          </div>
                        )}

                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px', flexWrap: 'wrap', gap: '10px', alignItems: 'center' }}>
                          <strong style={{ color: '#4a5568' }}>ワード一覧（タップで挿入）</strong>
                          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                            <form onSubmit={(e) => { e.preventDefault(); if (newWordText.trim()) { setWordItems([...wordItems, { id: `word-${Date.now()}`, type: 'word', text: newWordText.trim(), bgColor: '#bee3f8', textColor: '#2b6cb0', parentId: null, isOpen: true }]); setNewWordText(''); } }} style={{ display: 'flex', gap: '4px' }}>
                              <input type="text" value={newWordText} onChange={(e) => setNewWordText(e.target.value)} placeholder="新しいワードを入力..." style={{ padding: '4px 8px', borderRadius: '4px', border: '1px solid #cbd5e0', fontSize: '0.9rem', outline: 'none' }} />
                              <button type="submit" style={{ ...miniBtnStyle, backgroundColor: '#3182ce', color: 'white' }}>追加</button>
                            </form>
                            <button onClick={() => setWordItems([...wordItems, { id: `wfolder-${Date.now()}`, type: 'folder', text: '新規フォルダ', bgColor: '#edf2f7', textColor: '#2d3748', parentId: null, isOpen: true }])} style={miniBtnStyle}>📁 フォルダ</button>
                            <button onClick={() => setIsWordDeleteMode(!isWordDeleteMode)} style={{ ...miniBtnStyle, backgroundColor: isWordDeleteMode ? '#e53e3e' : '#f7fafc', color: isWordDeleteMode ? 'white' : '#2d3748' }}>{isWordDeleteMode ? '完了' : '🗑 整理'}</button>
                            <button onClick={() => { setIsWordBulkMode(!isWordBulkMode); if (isWordBulkMode) { setSelectedWordIds([]); setLastClickedWordId(null); } }} style={{ ...miniBtnStyle, backgroundColor: isWordBulkMode ? '#ed8936' : '#f7fafc', color: isWordBulkMode ? 'white' : '#2d3748' }}>{isWordBulkMode ? '完了' : '☑ 一括選択'}</button>
                          </div>
                        </div>
                        
                        
                        <div onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverWordId(null); setTimeout(() => setIsDraggingWord(false), 50); const draggedIdsStr = e.dataTransfer.getData('draggedWordIds'); if(!draggedIdsStr) return; const draggedIds: string[] = JSON.parse(draggedIdsStr); let newWords = [...wordItems]; const draggedItems = draggedIds.map(id => newWords.find(w => w.id === id)).filter(Boolean) as WordItem[]; newWords = newWords.filter(w => !draggedIds.includes(w.id)); draggedItems.forEach(item => item.parentId = null); newWords.unshift(...draggedItems); setWordItems(newWords); setSelectedWordIds([]); setLastClickedWordId(null); }} onDragOver={(e) => { e.preventDefault(); setDragOverWordId('root-top'); }} onDragLeave={() => setDragOverWordId(null)} style={{ padding: '8px', color: '#a0aec0', fontSize: '0.8rem', fontStyle: 'italic', borderBottom: dragOverWordId === 'root-top' ? '3px solid #3182ce' : 'none' }}>
                          ↓ ここにドロップしてフォルダから出す・一番上に移動
                        </div>

                        <div style={{ minHeight: '60px', maxHeight: isExpanded ? 'calc(100vh - 200px)' : '280px', overflowY: 'auto', padding: '10px', backgroundColor: '#fff', borderRadius: '6px', border: '1px inset #e2e8f0' }}>
                          {wordItems.length === 0 && <span style={{ color: '#a0aec0', fontSize: '0.9rem', display: 'block', padding: '10px' }}>ワードがありません。上のフォームから追加してください。</span>}
                          
                          {(() => {
                            const renderWordTree = (parentId: string | null) => {
                              const children = wordItems.filter(w => w.parentId === parentId);
                              if (children.length === 0 && parentId !== null) return null;
                              
                              return (
                                <div style={{ display: 'flex', flexDirection: parentId === null ? 'column' : 'row', flexWrap: parentId === null ? 'nowrap' : 'wrap', gap: parentId === null ? '8px' : '10px', width: '100%', padding: parentId === null ? '0' : '10px', backgroundColor: parentId === null ? 'transparent' : '#edf2f7', borderRadius: parentId === null ? '0' : '6px', marginTop: parentId === null ? '0' : '8px' }}>
                                  {children.map(word => {
                                    const isBlock = parentId === null || word.type === 'folder';
                                    const isTop = dragOverWordId === `${word.id}-top`;
                                    const isBottom = dragOverWordId === `${word.id}-bottom`;
                                    const isLeft = dragOverWordId === `${word.id}-left`;
                                    const isRight = dragOverWordId === `${word.id}-right`;
                                    const isInside = dragOverWordId === `${word.id}-inside`;

                                    return (
                                    <div key={word.id} style={{ display: 'flex', flexDirection: 'column', width: isBlock ? '100%' : 'auto' }}>
                                      <div style={{ position: 'relative', display: 'flex', width: '100%' }}>
                                        <button
                                          draggable={!isWordDeleteMode}
                                          onDragStart={(e) => { setIsDraggingWord(true); const dragIds = (isWordBulkMode && selectedWordIds.includes(word.id)) ? selectedWordIds : [word.id]; e.dataTransfer.setData('draggedWordIds', JSON.stringify(dragIds)); e.stopPropagation(); }}
                                          onDragEnd={() => { setTimeout(() => setIsDraggingWord(false), 50); }}
                                          onDrop={(e) => {
                                            e.preventDefault(); e.stopPropagation(); setDragOverWordId(null);
                                            setTimeout(() => setIsDraggingWord(false), 50); // ★移動に伴うドラッグフラグの解除漏れを防止
                                            const draggedIdsStr = e.dataTransfer.getData('draggedWordIds');
                                            if (!draggedIdsStr) return;
                                            const draggedIds: string[] = JSON.parse(draggedIdsStr);
                                            if (draggedIds.includes(word.id)) return;
                                            let isCyclic = false;
                                            let currentParent: string | null = (dragOverWordId === `${word.id}-inside`) ? word.id : word.parentId;
                                            while (currentParent) { if (draggedIds.includes(currentParent)) { isCyclic = true; break; } currentParent = wordItems.find(w => w.id === currentParent)?.parentId || null; }
                                            if (isCyclic) return;
                                            let newWords = [...wordItems];
                                            const draggedItems = draggedIds.map(id => newWords.find(w => w.id === id)).filter(Boolean) as WordItem[];
                                            newWords = newWords.filter(w => !draggedIds.includes(w.id));
                                            const targetIndex = newWords.findIndex(w => w.id === word.id);
                                            draggedItems.forEach((draggedItem, idx) => {
                                              if (dragOverWordId === `${word.id}-inside`) { draggedItem.parentId = word.id; newWords.push(draggedItem); } else {
                                                draggedItem.parentId = word.parentId;
                                                if (dragOverWordId === `${word.id}-top` || dragOverWordId === `${word.id}-left`) { newWords.splice(targetIndex + idx, 0, draggedItem); } else { newWords.splice(targetIndex + 1 + idx, 0, draggedItem); }
                                              }
                                            });
                                            setWordItems(newWords);
                                            // ★ 追加：ドロップ後に選択状態をクリア
                                            setSelectedWordIds([]);
                                            setLastClickedWordId(null);
                                          }}
                                          onDragOver={(e) => { 
                                            e.preventDefault(); e.stopPropagation(); 
                                            const rect = e.currentTarget.getBoundingClientRect(); const y = e.clientY - rect.top; const x = e.clientX - rect.left;
                                            if (word.type === 'folder') {
                                              if (y < rect.height * 0.25) setDragOverWordId(`${word.id}-top`); else if (y > rect.height * 0.75) setDragOverWordId(`${word.id}-bottom`); else setDragOverWordId(`${word.id}-inside`);
                                            } else {
                                              if (parentId === null) { if (y < rect.height / 2) setDragOverWordId(`${word.id}-top`); else setDragOverWordId(`${word.id}-bottom`); } else { if (x < rect.width / 2) setDragOverWordId(`${word.id}-left`); else setDragOverWordId(`${word.id}-right`); }
                                            }
                                          }}
                                          onDragLeave={() => setDragOverWordId(null)}
                                          onDoubleClick={(e) => { e.stopPropagation(); if (word.type === 'folder') { const newName = prompt('フォルダ名を変更', word.text); if (newName) setWordItems(wordItems.map(w => w.id === word.id ? { ...w, text: newName } : w)); } else { setTempBgColor(word.bgColor); setTempTextColor(word.textColor); setEditingWordId(word.id); } }}
                                          onClick={() => {
                                            if (isDraggingWord) return;
                                            if (isWordBulkMode) {
                                              const flatIds = getFlattenedVisibleWordIds(null);
                                              if (selectedWordIds.includes(word.id)) {
                                                setSelectedWordIds(selectedWordIds.filter(id => id !== word.id));
                                                setLastClickedWordId(null);
                                              } else {
                                                if (lastClickedWordId && flatIds.includes(lastClickedWordId)) {
                                                  const idx1 = flatIds.indexOf(lastClickedWordId);
                                                  const idx2 = flatIds.indexOf(word.id);
                                                  const start = Math.min(idx1, idx2);
                                                  const end = Math.max(idx1, idx2);
                                                  const rangeIds = flatIds.slice(start, end + 1);
                                                  setSelectedWordIds(Array.from(new Set([...selectedWordIds, ...rangeIds])));
                                                  setLastClickedWordId(word.id);
                                                } else {
                                                  setSelectedWordIds([...selectedWordIds, word.id]);
                                                  setLastClickedWordId(word.id);
                                                }
                                              }
                                              return;
                                            }
                                            if (word.type === 'folder') { setWordItems(wordItems.map(w => w.id === word.id ? { ...w, isOpen: !w.isOpen } : w)); } else if (!isWordDeleteMode) { handleInsertWord(word); }
                                          }}
                                          onMouseDown={(e) => { 
                                            if (isWordDeleteMode) {
                                              setWordItems(wordItems.filter(w => w.id !== word.id)); 
                                            }
                                          }}
                                          style={{ width: isBlock ? '100%' : 'auto', textAlign: 'left', padding: '6px 12px', borderRadius: word.type === 'folder' ? '6px' : '20px', borderTop: isTop ? '3px solid #3182ce' : '1px solid #cbd5e0', borderBottom: isBottom ? '3px solid #3182ce' : '1px solid #cbd5e0', borderLeft: isLeft ? '3px solid #3182ce' : '1px solid #cbd5e0', borderRight: isRight ? '3px solid #3182ce' : '1px solid #cbd5e0', outline: (isWordBulkMode && selectedWordIds.includes(word.id)) ? '3px solid #ed8936' : 'none', outlineOffset: '-1px', backgroundColor: isInside ? '#ebf8ff' : word.bgColor, color: word.textColor, cursor: isWordDeleteMode ? 'pointer' : (word.type === 'folder' ? 'pointer' : 'grab'), fontWeight: 'bold', fontSize: '1rem', transition: 'all 0.1s', display: 'flex', alignItems: 'center', gap: '5px', boxSizing: 'border-box' }}
                                        >
                                          {word.type === 'folder' && <span>{word.isOpen ? '📂' : '📁'}</span>} {word.text}
                                        </button>
                                        {isWordDeleteMode && <div style={{ position: 'absolute', top: -5, right: -5, background: 'red', color: 'white', borderRadius: '50%', width: '18px', height: '18px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', pointerEvents: 'none', zIndex: 10 }}>✕</div>}
                                      </div>
                                      {word.type === 'folder' && word.isOpen && renderWordTree(word.id)}
                                    </div>
                                  )})}
                                </div>
                              );
                            }
                            return renderWordTree(null);
                          })()}
                        </div>
                      </div>
                    )}

                    {/* ワード色変更ポップアップ */}
                    {editingWordId && (() => {
                      const word = wordItems.find(w => w.id === editingWordId);
                      if (!word) return null;
                      return (
                        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 10002, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
                          <div style={{ backgroundColor: '#fff', padding: '20px', borderRadius: '8px', width: '320px', display: 'flex', flexDirection: 'column', gap: '20px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
                            <h3 style={{ margin: 0, color: '#2d3748', textAlign: 'center' }}>色の変更</h3>
                            <div style={{ display: 'flex', justifyContent: 'space-around', alignItems: 'center' }}>
                              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px' }}><span style={{ fontSize: '0.8rem', color: '#718096' }}>背景色</span><input type="color" value={tempBgColor} onChange={(e) => setTempBgColor(e.target.value)} style={{ width: '40px', height: '40px', cursor: 'pointer', border: 'none', padding: 0 }} /></div>
                              <span style={{ fontSize: '1.5rem', color: '#cbd5e0' }}>+</span>
                              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '5px' }}><span style={{ fontSize: '0.8rem', color: '#718096' }}>文字色</span><input type="color" value={tempTextColor} onChange={(e) => setTempTextColor(e.target.value)} style={{ width: '40px', height: '40px', cursor: 'pointer', border: 'none', padding: 0 }} /></div>
                              <span style={{ fontSize: '1.5rem', color: '#cbd5e0' }}>=</span>
                              <div style={{ padding: '4px 12px', borderRadius: '20px', backgroundColor: tempBgColor, color: tempTextColor, fontWeight: 'bold', border: '1px solid #e2e8f0' }}>{word.text}</div>
                            </div>
                            <div style={{ backgroundColor: '#f7fafc', padding: '10px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
                              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                                <span style={{ fontSize: '0.85rem', fontWeight: 'bold', color: '#4a5568' }}>選抜色（保存済み）</span>
                                <button onClick={() => setIsColorDeleteMode(!isColorDeleteMode)} style={{ ...miniBtnStyle, backgroundColor: isColorDeleteMode ? '#e53e3e' : '#fff', color: isColorDeleteMode ? '#fff' : '#2d3748' }}>{isColorDeleteMode ? '完了' : '整理'}</button>
                              </div>
                              <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
                                {savedColors.map((color, idx) => (
                                  <div key={idx} style={{ position: 'relative' }}>
                                    <div onClick={() => { if (isColorDeleteMode) { setSavedColors(savedColors.filter((_, i) => i !== idx)); } else { setTempBgColor(color.bg); setTempTextColor(color.text); } }} style={{ width: '32px', height: '32px', backgroundColor: color.bg, border: `2px solid ${color.text}`, borderRadius: '6px', cursor: 'pointer' }} />
                                    {isColorDeleteMode && <div style={{ position: 'absolute', top: -6, right: -6, background: 'red', color: 'white', borderRadius: '50%', width: '16px', height: '16px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '10px', pointerEvents: 'none', fontWeight: 'bold' }}>✕</div>}
                                  </div>
                                ))}
                              </div>
                            </div>
                            <div style={{ display: 'flex', gap: '10px' }}>
                              <button onClick={() => { setEditingWordId(null); setIsColorDeleteMode(false); }} style={{ ...btnStyle, flex: 1 }}>キャンセル</button>
                              <button onClick={() => { setWordItems(wordItems.map(w => w.id === editingWordId ? { ...w, bgColor: tempBgColor, textColor: tempTextColor } : w)); if (!savedColors.find(c => c.bg === tempBgColor && c.text === tempTextColor)) { setSavedColors([...savedColors, { bg: tempBgColor, text: tempTextColor }]); } setEditingWordId(null); setIsColorDeleteMode(false); }} style={{ ...btnStyle, backgroundColor: '#3182ce', color: 'white', flex: 1, border: 'none' }}>保存して反映</button>
                            </div>
                          </div>
                        </div>
                      );
                    })()}
                  </div>

                  {/* ★ QとAのエディタ本体 (きれいに横並び/縦並びに統一) */}
                  <div style={{ 
                    display: 'flex', 
                    flexDirection: isExpanded && !isMobileView ? 'row' : (isMobileView ? 'column' : 'row'), 
                    gap: '20px', 
                    width: '100%',
                    flex: isExpanded ? 1 : 'none'
                  }}>
                    {/* Q枠 (解答拡大時は非表示) */}
                    <div style={{ display: isAnswerMaximized ? 'none' : 'flex', flex: (!isExpanded && isMobileView) ? 'none' : 1, flexDirection: 'column', border: '1px solid #cbd5e0', borderRadius: '6px', height: isExpanded ? '100%' : '250px', minHeight: isExpanded ? 0 : '250px' }}>
                      <div style={{ padding: '10px', backgroundColor: '#ebf8ff', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #cbd5e0', borderTopLeftRadius: '6px', borderTopRightRadius: '6px' }}>
                        <strong style={{ color: '#2b6cb0', fontSize: '1.1rem' }}>問題</strong>
                        <button onClick={() => handleFloatingImageInsertBtn(true)} style={miniBtnStyle}>🖼 画像</button>
                      </div>
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '10px', position: 'relative', overflow: 'auto' }}>
                        {isEnglishMode && (
                          <div style={{ display: 'flex', gap: '10px', paddingBottom: '10px', marginBottom: '10px', borderBottom: '2px dashed #cbd5e0', flexShrink: 0 }}>
                            <input id="engWordInput" type="text" placeholder="英単語を入力..." value={engWord} onChange={(e) => { setEngWord(e.target.value); const rect = e.target.getBoundingClientRect(); setSuggestionPos({ top: rect.bottom + window.scrollY, left: rect.left + window.scrollX }); setSuggestionTarget('engWord'); }} onKeyDown={handleEngWordKeyDown} onFocus={(e) => { lastRangeRef.current = null; if (e.target.value.length >= 2) { const rect = e.target.getBoundingClientRect(); setSuggestionPos({ top: rect.bottom + window.scrollY, left: rect.left + window.scrollX }); setSuggestionTarget('engWord'); } }} onBlur={() => setTimeout(() => setSuggestionTarget(null), 200)} style={{ flex: 1, padding: '6px', borderRadius: '4px', border: '1px solid #a0aec0', fontSize: '1rem', outline: 'none' }} />
                            <input type="text" placeholder="発音記号 (自動)" value={engPhonetic} onChange={(e) => setEngPhonetic(e.target.value)} onFocus={() => { lastRangeRef.current = null; }} style={{ width: '120px', padding: '6px', borderRadius: '4px', border: '1px solid #a0aec0', backgroundColor: '#f7fafc', fontSize: '0.9rem', outline: 'none' }} />
                          </div>
                        )}
                        {renderNewImages(qImages, true)}
                        <div ref={questionRef} contentEditable onInput={handleBoxInput} onKeyDown={handleBoxKeyDown} onBlur={() => setTimeout(() => setSuggestionTarget(null), 200)} onKeyUp={saveCursorPosition} onMouseUp={saveCursorPosition} className="rich-text-content" onDrop={(e) => handleDropFromStock(e, true)} onDragOver={(e) => e.preventDefault()} style={{ flex: 1, outline: 'none', fontSize: `${tempCreateFontSize}px`, textAlign: 'left', whiteSpace: 'pre', color: '#000000', minWidth: 'max-content' }} />
                      </div>
                    </div>
                    
                    {/* A枠 */}
                    <div style={{ flex: (!isExpanded && isMobileView) ? 'none' : 1, display: 'flex', flexDirection: 'column', border: '1px solid #cbd5e0', borderRadius: '6px', height: isExpanded ? '100%' : '250px', minHeight: isExpanded ? 0 : '250px' }}>
                      <div style={{ padding: '10px', backgroundColor: '#fff5f5', display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid #cbd5e0', borderTopLeftRadius: '6px', borderTopRightRadius: '6px' }}>
                        <strong style={{ color: '#c53030', fontSize: '1.1rem' }}>解答</strong>
                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                          {/* ★ 追加: さらに拡大ボタン (拡大時のみ表示) */}
                          {isExpanded && (
                            <button onClick={() => setIsAnswerMaximized(!isAnswerMaximized)} style={{ ...miniBtnStyle, backgroundColor: '#fed7d7', color: '#c53030' }}>
                              {isAnswerMaximized ? '元に戻す' : 'さらに拡大 ⤢'}
                            </button>
                          )}
                          <button onClick={() => { if (answerRef.current) answerRef.current.innerHTML = ''; }} style={{ ...miniBtnStyle, color: '#e53e3e' }}>消去</button>
                          <button onClick={() => handleFloatingImageInsertBtn(false)} style={miniBtnStyle}>🖼 画像</button>
                        </div>
                      </div>
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '10px', position: 'relative', overflow: 'auto' }}>
                        {renderNewImages(aImages, false)}
                        <div ref={answerRef} contentEditable onInput={handleBoxInput} onKeyDown={handleBoxKeyDown} onBlur={() => setTimeout(() => setSuggestionTarget(null), 200)} onKeyUp={saveCursorPosition} onMouseUp={saveCursorPosition} className="rich-text-content" onDrop={(e) => handleDropFromStock(e, false)} onDragOver={(e) => e.preventDefault()} style={{ flex: 1, outline: 'none', fontSize: `${tempCreateFontSize}px`, textAlign: 'left', whiteSpace: 'pre', color: '#000000', minWidth: 'max-content' }} />
                      </div>
                    </div>
                  </div>

                  <button onClick={async () => {
                    let qHTML = questionRef.current?.innerHTML || ''; 
                    const aHTML = answerRef.current?.innerHTML || '';

                    // ★ 英単語モードの自動フォーマット処理（IPA完全ローカル ＋ 音節は本物辞書の自動キャッシュ）
                    if (isEnglishMode && engWord.trim()) {
                      let inputWord = engWord.trim();
                      let phonetic = engPhonetic.trim();

                      // 1. 発音記号(IPA)の取得（13万語ローカルJSONから爆速取得）
                      if (!phonetic) {
                        const dict = await loadIpaDict();
                        const words = inputWord.split(/\s+/);
                        const pArray = [];
                        for (let w of words) {
                          let cleanWord = w.replace(/[^a-zA-Z'-]/g, '').toLowerCase();
                          if (!cleanWord) continue;
                          const getIPA = (target: string) => {
                            if (localWordDict[target]?.p) return localWordDict[target].p;
                            if (dict && dict[target]) {
                               let ipa = dict[target];
                               return ipa.startsWith('/') ? ipa : `/${ipa}/`;
                            }
                            return '';
                          };
                          let p = getIPA(cleanWord);
                          if (!p) {
                            let rootWord = cleanWord;
                            if (cleanWord.endsWith('ies')) rootWord = cleanWord.slice(0, -3) + 'y';
                            else if (cleanWord.endsWith('es')) rootWord = cleanWord.slice(0, -2);
                            else if (cleanWord.endsWith('s') && !cleanWord.endsWith('ss')) rootWord = cleanWord.slice(0, -1);
                            else if (cleanWord.endsWith('ing')) rootWord = cleanWord.slice(0, -3);
                            else if (cleanWord.endsWith('ed')) rootWord = cleanWord.slice(0, -2);
                            if (rootWord !== cleanWord) p = getIPA(rootWord);
                          }
                          if (p) pArray.push(p);
                        }
                        phonetic = pArray.join(' ');
                      }

                      // 2. 音節(シラブル)の取得関数（Wiktionaryから取得してIndexedDBに永久保存）
                      const sylDict = await loadSyllableDict();
                      const getSyllable = async (target: string) => {
                        if (localWordDict[target]?.f) return localWordDict[target].f;
                        if (sylDict[target]) return sylDict[target]; // キャッシュにあれば即答

                        // キャッシュにない場合はWiktionary（本物の辞書）へ取得しに行く
                        try {
                          const res = await fetch(`https://en.wiktionary.org/api/rest_v1/page/html/${target}`);
                          if (res.ok) {
                            const html = await res.text();
                            const hyphMatch = html.match(/Hyphenation:.*?<span[^>]*>((?:[^<]+|<!--.*?-->)+)<\/span>/is);
                            if (hyphMatch) {
                              let wiktHyph = hyphMatch[1].replace(/<!--.*?-->/g, '').replace(/<[^>]+>/g, '').trim();
                              if (wiktHyph.includes('‧')) {
                                const finalSyl = wiktHyph.replace(/‧/g, '-');
                                await saveSyllable(target, finalSyl); // ★ 取得できたらIndexedDBに記憶させる
                                return finalSyl;
                              }
                            }
                          }
                        } catch {} // ★変更: 使っていない (e) を削除

                        // 最終手段：Hypherアルゴリズム
                        if (target.length >= 3) {
                          const parts = h.hyphenate(target);
                          if (parts && parts.length > 1) {
                            let res = parts.join('-');
                            return res.replace(/([bcdfghjklmnpqrstvwxyz])-?ity\b/gi, "$1-i-ty");
                          }
                        }
                        return target;
                      };

                      // 3. 入力された文字列の記号や大文字小文字を維持したまま、単語部分だけを音節化
                      let formattedWord = '';
                      if (inputWord.includes('-')) {
                        // 既に手動でハイフンが入っている場合はそのまま
                        formattedWord = inputWord;
                      } else {
                        const tokens = inputWord.split(/([a-zA-Z]+)/);
                        for (let i = 0; i < tokens.length; i++) {
                          if (/[a-zA-Z]+/.test(tokens[i])) {
                            const lower = tokens[i].toLowerCase();
                            let syl = await getSyllable(lower);
                            // 先頭が大文字なら大文字に戻す
                            if (tokens[i][0] === tokens[i][0].toUpperCase()) {
                              syl = syl.charAt(0).toUpperCase() + syl.slice(1);
                            }
                            tokens[i] = syl;
                          }
                        }
                        formattedWord = tokens.join('');
                      }

                      const engHeader = `<div style="margin-bottom: 12px; padding-bottom: 8px; border-bottom: 1px dashed #cbd5e0; display: flex; align-items: baseline; gap: 15px;"><strong style="font-size: 1.4em; color: #2b6cb0; letter-spacing: 1px;">${formattedWord}</strong><span style="font-family: sans-serif; color: #718096; font-size: 1.1em;">${phonetic}</span></div>`;
                      qHTML = engHeader + qHTML;
                      
                      setEngWord('');
                      setEngPhonetic('');
                    }

                    if (!qHTML.trim() && !aHTML.trim() && qImages.length === 0 && aImages.length === 0) return alert('入力してください。')
                    if (editingCardId) { 
                      updateActiveFile(i => ({ ...i, cards: i.cards.map(c => c.id === editingCardId ? { ...c, question: qHTML, answer: aHTML, qImages: [...qImages], aImages: [...aImages], fontSize } : c) })); 
                      setEditingCardId(null); setIsExpanded(false); 
                    } else { 
                      const newCard: Card = { id: Date.now().toString(), question: qHTML, answer: aHTML, qImages: [...qImages], aImages: [...aImages], fontSize }; 
                      updateActiveFile(i => ({ ...i, cards: [...i.cards, newCard] })); 
                    }
                    if (questionRef.current) questionRef.current.innerHTML = ''; if (answerRef.current) answerRef.current.innerHTML = ''; setQImages([]); setAImages([])
                  }} style={{ ...btnStyle, backgroundColor: editingCardId ? '#d69e2e' : '#3182ce', color: 'white', width: '100%', padding: '10px', marginTop: '15px' }}>{editingCardId ? '更新する' : 'カードを追加'}</button>
                </div>
              )}

              {(() => {
                // ★ 閲覧モード（!isTestMode）は新着順（逆順）、テストモードは元の順
                const displayCards = activeFile?.cards ? (isTestMode ? [...activeFile.cards] : [...activeFile.cards].reverse()) : [];
                return (
                  <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => { 
                    const { active, over } = e; 
                    if (over && active.id !== over.id && activeFile) { 
                      const oldIndex = displayCards.findIndex(c => c.id === active.id);
                      const newIndex = displayCards.findIndex(c => c.id === over.id);
                      const updatedDisplayCards = arrayMove(displayCards, oldIndex, newIndex);
                      // ★ 保存する時は元の向きに戻す（並び替えによるデータの破損を防ぐ）
                      updateActiveFile(i => ({ ...i, cards: isTestMode ? updatedDisplayCards : updatedDisplayCards.reverse() })); 
                    } 
                  }}>
                    <SortableContext items={displayCards.map(c => c.id)} strategy={verticalListSortingStrategy}>
                      {/* ★ スマホで閲覧・テスト中は横スクロール（スワイプ）にする */}
                      <div style={
                        isGlobalCardsExpanded ? {
                          position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', zIndex: 10000,
                          backgroundColor: '#fff',
                          display: isMobileView ? 'flex' : 'block',
                          flexDirection: isMobileView ? 'row' : undefined,
                          overflowX: isMobileView ? 'auto' : 'hidden',
                          overflowY: isMobileView ? 'hidden' : 'auto',
                          scrollSnapType: isMobileView ? 'x mandatory' : 'y mandatory',
                        } : {
                          display: 'flex', flexDirection: (isMobileView && !isEditMode) ? 'row' : 'column', gap: '20px', overflowX: (isMobileView && !isEditMode) ? 'auto' : 'visible', scrollSnapType: (isMobileView && !isEditMode) ? 'x mandatory' : 'none', paddingBottom: '10px'
                        }
                      }>
                        {displayCards.map((card, index) => <SortableCard key={card.id} card={card} index={isTestMode ? index + 1 : displayCards.length - index} isTestMode={isTestMode} isEditMode={isEditMode} isMobileView={isMobileView} isCardExpanded={isGlobalCardsExpanded} onToggleExpand={() => setIsGlobalCardsExpanded(!isGlobalCardsExpanded)} onDelete={(id) => updateActiveFile(i => ({ ...i, cards: i.cards.filter(c => c.id !== id) }))} onEdit={(c)=>{ setEditingCardId(c.id); setFontSize(c.fontSize || 16); if (questionRef.current) questionRef.current.innerHTML = c.question; if (answerRef.current) answerRef.current.innerHTML = c.answer; setQImages([...c.qImages]); setAImages([...c.aImages]); window.scrollTo({ top: 0, behavior: 'smooth' }); setIsGlobalCardsExpanded(false); }} onCopy={(q, a) => { setCopiedQA({ q, a }); }} />)}
                      </div>
                    </SortableContext>
                  </DndContext>
                );
              })()}
            </div>
          </div>
        </div>
      )}
      
      {/* ★ 統合版：ボックス・英単語入力欄の両方で動くサジェストUI */}
      {suggestionTarget && suggestionPos && (suggestionTarget === 'engWord' ? engSuggestions : boxSuggestions).length > 0 && (
        <div ref={suggestionContainerRef} style={{ position: 'absolute', top: suggestionPos.top + 5, left: suggestionPos.left, backgroundColor: '#fff', border: '1px solid #cbd5e0', borderRadius: '6px', boxShadow: '0 4px 12px rgba(0,0,0,0.15)', zIndex: 20000, maxHeight: '200px', overflowY: 'auto', display: 'flex', flexDirection: 'column', minWidth: '150px' }}>
          {(suggestionTarget === 'engWord' ? engSuggestions : boxSuggestions).map((sug, idx) => (
            <div key={idx} onMouseDown={(e) => { 
                e.preventDefault(); 
                if (suggestionTarget === 'engWord') {
                  setEngWord(sug);
                  setSuggestionTarget(null);
                  setSelectedSuggestionIndex(-1);
                } else {
                  applyBoxSuggestion(sug); 
                }
              }} style={{ padding: '8px 12px', cursor: 'pointer', borderBottom: idx !== (suggestionTarget === 'engWord' ? engSuggestions : boxSuggestions).length - 1 ? '1px solid #edf2f7' : 'none', color: '#2b6cb0', fontWeight: 'bold', fontSize: '1rem', backgroundColor: idx === selectedSuggestionIndex ? '#ebf8ff' : 'transparent' }} onMouseEnter={() => setSelectedSuggestionIndex(idx)} onMouseLeave={() => setSelectedSuggestionIndex(-1)}>
              {sug}
            </div>
          ))}
        </div>
      )}

    </div>
  )
}

const btnStyle = { padding: '8px 16px', borderRadius: '6px', border: '1px solid #cbd5e0', backgroundColor: '#ffffff', cursor: 'pointer', fontWeight: 'bold' as const, color: '#2d3748' }
const miniBtnStyle = { padding: '4px 8px', fontSize: '0.8rem', borderRadius: '4px', border: '1px solid #ccc', cursor: 'pointer', backgroundColor: '#f7fafc', fontWeight: 'bold' as const, color: '#2d3748' }
const expandBtnStyleBig = { padding: '8px 16px', fontSize: '1rem', borderRadius: '6px', border: '2px solid #a0aec0', cursor: 'pointer', backgroundColor: '#edf2f7', fontWeight: 'bold' as const, color: '#2d3748' }