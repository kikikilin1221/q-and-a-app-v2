import { useState, useRef, useEffect } from 'react'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors
} from '@dnd-kit/core'
import type { DragEndEvent } from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Rnd } from 'react-rnd'

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
interface StockImage { id: string; src: string }
interface Card { id: string; question: string; answer: string; qImages: FloatingImage[]; aImages: FloatingImage[]; fontSize: number }
type ItemType = 'file' | 'folder'
interface AppItem { id: string; type: ItemType; name: string; parentId: string | null; cards: Card[] }

// --- ユーティリティ ---
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

function RichToolbar({ hasSelection }: { hasSelection: boolean }) {
  const handleFormat = (e: React.MouseEvent, command: string, value?: string) => {
    e.preventDefault();
    if (command === 'doubleUnderline') {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const html = `<span style="border-bottom: 3px double currentColor;">${sel.toString()}</span>`;
        document.execCommand('insertHTML', false, html);
      }
    } else { document.execCommand(command, false, value); }
  };
  return (
    <div style={{ display: 'flex', gap: '8px', marginBottom: '8px', opacity: hasSelection ? 1 : 0.4, pointerEvents: hasSelection ? 'auto' : 'none', alignItems: 'center', backgroundColor: '#f7fafc', padding: '6px', borderRadius: '6px', border: '1px solid #e2e8f0' }}>
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

function SortableCard({ card, index, isTestMode, isEditMode, onDelete, onUpdate, onEdit, fontSize, isMobileView }: { card: Card, index: number, isTestMode: boolean, isEditMode: boolean, onDelete: (id: string) => void, onUpdate: (c: Card) => void, onEdit: (c: Card) => void, fontSize: number, isMobileView: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isOver } = useSortable({ id: card.id })
  const [expanded, setExpanded] = useState<'none' | 'q' | 'a'>('none')
  const [revealed, setRevealed] = useState(false)
  const [tempFontSize, setTempFontSize] = useState<number>(card.fontSize || 16)

  useEffect(() => { setRevealed(!isTestMode) }, [isTestMode])
  useEffect(() => { if (expanded === 'none') setTempFontSize(card.fontSize || 16) }, [expanded, card.fontSize])

  const style = { transform: expanded !== 'none' ? 'none' : CSS.Transform.toString(transform), transition: expanded !== 'none' ? 'none' : transition, border: isOver ? '3px dashed #3182ce' : '1px solid #e2e8f0', borderRadius: '8px', padding: '16px', backgroundColor: '#ffffff', boxShadow: isOver ? '0 4px 12px rgba(49, 130, 206, 0.3)' : '0 2px 4px rgba(0,0,0,0.05)', position: 'relative' as const, zIndex: expanded !== 'none' ? 9999 : 1, color: '#2d3748' }
  const togglePin = (imgId: string, isQ: boolean) => {
    const newCard = { ...card };
    if (isQ) newCard.qImages = newCard.qImages.map(img => img.id === imgId ? { ...img, pinned: !img.pinned } : img);
    else newCard.aImages = newCard.aImages.map(img => img.id === imgId ? { ...img, pinned: !img.pinned } : img);
    onUpdate(newCard);
  }
  const renderImages = (images: FloatingImage[], isQ: boolean) => {
    return (
      <>
        {images.map(img => (
          <div key={img.id} style={{ position: 'absolute', left: img.x, top: img.y, width: img.width, height: img.height, zIndex: 10 }}>
            {isEditMode && (
              <button onClick={(e) => { e.stopPropagation(); togglePin(img.id, isQ) }} style={{ position: 'absolute', top: -25, right: 0, ...miniBtnStyle }}>
                {img.pinned ? '動かす' : '固定'}
              </button>
            )}
            <img src={img.src} style={{ width: '100%', height: '100%', borderRadius: '4px', pointerEvents: 'none' }} alt="" />
          </div>
        ))}
      </>
    )
  }

  const baseBoxStyle = { fontFamily: 'sans-serif', position: 'relative' as const, height: '250px', width: '100%', minWidth: '0', maxWidth: '100%', border: '1px solid #e2e8f0', /* ...以下略 */ }
  const expandedStyle = (isRight: boolean) => ({ position: 'fixed' as const, top: 0, left: (isRight && !isMobileView) ? '50vw' : 0, width: isMobileView ? '100vw' : '50vw', height: '100vh', zIndex: 10000, padding: '40px', boxShadow: isRight ? '-4px 0 15px rgba(0,0,0,0.2)' : '4px 0 15px rgba(0,0,0,0.2)', backgroundColor: '#fff', display: 'flex', flexDirection: 'column' as const, boxSizing: 'border-box' as const, color: '#2d3748' })
  const innerContentStyle = (isExpanded: boolean) => ({ ...(isExpanded ? { flex: 1, height: '100%', width: '100%', border: '1px solid #e2e8f0', padding: '10px', overflowX: 'auto' as const, overflowY: 'auto' as const, position: 'relative' as const, textAlign: 'left' as const, whiteSpace: 'pre' as const, boxSizing: 'border-box' as const, fontSize: `${tempFontSize}px`, color: '#2d3748', fontFamily: 'sans-serif', display: 'flex', flexDirection: 'column' } : baseBoxStyle) } as React.CSSProperties)

  return (
    <div ref={setNodeRef} style={style}>
      {isEditMode && (
        <div {...attributes} {...listeners} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px', borderBottom: '1px solid #eee', paddingBottom: '8px', cursor: 'grab' }}>
          <span style={{ fontSize: '0.85rem', color: '#666', fontWeight: 'bold' }}>⠿ ここをドラッグして並び替え</span>
          <button onClick={() => onDelete(card.id)} style={{ color: '#e53e3e', border: 'none', background: 'none', cursor: 'pointer', fontWeight: 'bold' }}>削除</button>
        </div>
      )}
      {/* ★ スマホ時はflexにして横スクロール（スワイプ）できるようにする */}
      <div style={{ display: isMobileView ? 'flex' : 'grid', gridTemplateColumns: isMobileView ? undefined : '390px 390px', gap: '20px', justifyContent: isMobileView ? 'flex-start' : 'center', overflowX: isMobileView ? 'auto' : 'visible', scrollSnapType: isMobileView ? 'x mandatory' : 'none', width: '100%', paddingBottom: isMobileView ? '10px' : '0' }}>
        {/* Qのコンテナ（横幅100%を確保してピタッと止まるようにする） */}
        <div style={{ ...(expanded === 'q' ? expandedStyle(false) : { flex: isMobileView ? '0 0 100%' : 'auto', scrollSnapAlign: 'start', minWidth: '0' }) }}>
          <strong style={{ color: '#2b6cb0', display: 'flex', justifyContent: 'space-between', marginBottom: '8px', alignItems: 'center' }}>
            <span style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>Q{index}: 問題{!isTestMode && <button onClick={() => onEdit(card)} style={{ ...miniBtnStyle, backgroundColor: '#bee3f8', color: '#2b6cb0' }}>編集する</button>}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {expanded === 'q' && <div style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '5px', color: '#2d3748' }}>一時拡大文字: <input type="range" min="5" max="32" value={tempFontSize} onChange={(e) => setTempFontSize(Number(e.target.value))} /> {tempFontSize}px</div>}
              <button onClick={() => setExpanded(expanded === 'q' ? 'none' : 'q')} style={expandBtnStyleBig}>{expanded === 'q' ? '縮小 ⤡' : '拡大 ⤢'}</button>
            </div>
          </strong>
          <div style={innerContentStyle(expanded === 'q')}>
            {renderImages(card.qImages, true)}
            <div dangerouslySetInnerHTML={{ __html: renderLatex(card.question) }} className="rich-text-content" style={{ flex: 1 }} />
          </div>
        </div>
        {/* Aのコンテナ */}
        <div style={{ ...(expanded === 'a' ? expandedStyle(true) : { flex: isMobileView ? '0 0 100%' : 'auto', scrollSnapAlign: 'start', minWidth: '0' }) }} onClick={() => { if (isTestMode) setRevealed(!revealed) }}>
          <strong style={{ color: '#c53030', display: 'flex', justifyContent: 'space-between', marginBottom: '8px', alignItems: 'center' }}>
            <span>A{index}: 解答 {isTestMode && <span style={{fontSize: '0.8rem', color: '#e53e3e', marginLeft: '10px'}}>(クリックで表示)</span>}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              {expanded === 'a' && <div style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: '5px', color: '#2d3748' }}>一時拡大文字: <input type="range" min="5" max="32" value={tempFontSize} onChange={(e) => setTempFontSize(Number(e.target.value))} /> {tempFontSize}px</div>}
              <button onClick={(e) => { e.stopPropagation(); setExpanded(expanded === 'a' ? 'none' : 'a'); }} style={expandBtnStyleBig}>{expanded === 'a' ? '縮小 ⤡' : '拡大 ⤢'}</button>
            </div>
          </strong>
          <div style={{ ...innerContentStyle(expanded === 'a'), cursor: isTestMode ? 'pointer' : 'default' }}>
            <div style={{ opacity: (!revealed) ? 0 : 1, transition: 'opacity 0.2s', height: '100%', display: 'flex', flexDirection: 'column' }}>
              {renderImages(card.aImages, false)}
              <div dangerouslySetInnerHTML={{ __html: renderLatex(card.answer) }} className="rich-text-content" style={{ flex: 1 }} />
            </div>
            {!revealed && <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', fontWeight: 'bold', color: '#a0aec0' }}>クリックで解答を表示</div>}
          </div>
        </div>
      </div>
      {expanded !== 'none' && <div onClick={() => setExpanded('none')} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 9998 }} />}
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
  const [otpToken, setOtpToken] = useState('')
  const [authMessage, setAuthMessage] = useState('')
  const [isAuthLoading, setIsAuthLoading] = useState(true)

  const [currentScreen, setCurrentScreen] = useState<'room' | 'editor'>('room')
  const [items, setItems] = useState<AppItem[]>([])
  
  const [activeFileId, setActiveFileId] = useState<string | null>(null)
  const [editingItemId, setEditingItemId] = useState<string | null>(null)
  const [dragOverRoomId, setDragOverRoomId] = useState<string | null>(null)
  
  const [editingCardId, setEditingCardId] = useState<string | null>(null)
  const [isMobileView, setIsMobileView] = useState(window.innerWidth <= 768);
  const [isRoomDeleteMode, setIsRoomDeleteMode] = useState(false);

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
  const [createExpanded, setCreateExpanded] = useState<'none' | 'q' | 'a'>('none')

  const [stockImages, setStockImages] = useState<StockImage[]>([])
  const [tempCreateFontSize, setTempCreateFontSize] = useState<number>(16)
  const [hasSelection, setHasSelection] = useState(false)
  
  const [isDataLoaded, setIsDataLoaded] = useState(false)

  const questionRef = useRef<HTMLDivElement>(null)
  const answerRef = useRef<HTMLDivElement>(null)
  
  const activeFile = items.find(i => i.id === activeFileId && i.type === 'file')
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))

  // ★ テーマカラー変数の定義
  const appBgColor = isDarkMode ? '#1a202c' : '#f7fafc';
  const textColor = isDarkMode ? '#e2e8f0' : '#2d3748';

  useEffect(() => {
    localStorage.setItem('kiokushiyo_theme', isDarkMode ? 'dark' : 'light');
  }, [isDarkMode])

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session); setIsAuthLoading(false)
    })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })
    return () => subscription.unsubscribe()
  }, [])

  useEffect(() => {
    const fetchCloudData = async () => {
      if (!session?.user?.id) return;
      try {
        const { data, error } = await supabase.from('user_store').select('items').eq('id', session.user.id).single();
        if (error && error.code !== 'PGRST116') console.error('読み込みエラー:', error);
        if (data && data.items) setItems(data.items);
      } catch (err) { console.error('通信エラー:', err); } finally { setIsDataLoaded(true); }
    };
    if (session) fetchCloudData();
  }, [session]);

  useEffect(() => {
    if (!isDataLoaded || !session?.user?.id) return;
    const saveCloudData = async () => {
      const { error } = await supabase.from('user_store').upsert({ id: session.user.id, items: items });
      if (error) console.error('保存エラー:', error);
    };
    saveCloudData();
  }, [items, isDataLoaded, session]);

  // ★ サインアップ処理
  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthMessage('処理中...');
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) {
      setAuthMessage(`エラー: ${error.message}`);
    } else {
      setAuthMessage('確認メールを送信しました！メール内のリンクをクリックして有効化してからログインしてください。');
      setAuthMode('login');
    }
  };

  // ★ ログイン処理
  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthMessage('ログイン中...');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setAuthMessage(`ログイン失敗: ${error.message}`);
    } else {
      setAuthMessage('');
    }
  };
  const handleSignOut = async () => {
    await supabase.auth.signOut(); setItems([]); setIsDataLoaded(false); setAuthMode('login');
  };

  useEffect(() => { if (createExpanded === 'none') setTempCreateFontSize(fontSize); }, [createExpanded, fontSize])
  useEffect(() => {
    const handleSelection = () => { const sel = window.getSelection(); setHasSelection(!!(sel && sel.rangeCount > 0 && !sel.isCollapsed)); };
    document.addEventListener('selectionchange', handleSelection);
    return () => document.removeEventListener('selectionchange', handleSelection);
  }, []);

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
              <Rnd key={img.id} lockAspectRatio={true} size={{ width: img.width, height: img.height }} position={{ x: img.x, y: img.y }} onDragStop={(e, d) => isQ ? setQImages(prev => prev.map(i => i.id === img.id ? { ...i, x: d.x, y: d.y } : i)) : setAImages(prev => prev.map(i => i.id === img.id ? { ...i, x: d.x, y: d.y } : i))} onResizeStop={(e, dir, ref, delta, pos) => isQ ? setQImages(prev => prev.map(i => i.id === img.id ? { ...i, width: parseInt(ref.style.width), height: parseInt(ref.style.height), ...pos } : i)) : setAImages(prev => prev.map(i => i.id === img.id ? { ...i, width: parseInt(ref.style.width), height: parseInt(ref.style.height), ...pos } : i))} tabIndex={0} onFocus={() => setSelectedImgId(img.id)} onBlur={() => setSelectedImgId(null)} onKeyDown={(e: any) => handleImageKeyDown(e, img.id, isQ)} style={{ border: selectedImgId === img.id ? '2px solid red' : '2px dashed #3182ce', zIndex: 11, outline: 'none' }}>
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
      
      {/* ★ 丸ゴシック体の読み込みとBGM設定を追加、およびリッチテキスト内の文字サイズ強制上書き */}
      <style>
        {`
          @import url('https://fonts.googleapis.com/css2?family=Zen+Maru+Gothic:wght@900&display=swap');
          .rich-text-content * {
            font-size: inherit !important;
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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '2px solid #e2e8f0', paddingBottom: '15px', marginBottom: '20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
              <img src="/logo.jpg" alt="ロゴ" style={{ width: '60px', height: '60px', borderRadius: '12px', objectFit: 'cover' }} />
              <h1 style={{ color: isDarkMode ? '#ffffff' : '#2d3748', margin: 0, fontSize: '2.2rem', letterSpacing: '2px', fontFamily: '"Zen Maru Gothic", sans-serif', fontWeight: 900 }}>キオクシヨ</h1>
            </div>
            <div style={{ display: 'flex', gap: '10px' }}>
              {/* ★ テーマ切り替えボタン */}
              <button onClick={() => setIsDarkMode(!isDarkMode)} style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid #a0aec0', backgroundColor: isDarkMode ? '#2d3748' : '#fff', cursor: 'pointer', color: isDarkMode ? '#e2e8f0' : '#2d3748', fontWeight: 'bold' }}>
                {isDarkMode ? '☀️ ライトモード' : '🌙 ダークモード'}
              </button>
              <button onClick={handleSignOut} style={{ padding: '6px 12px', borderRadius: '6px', border: '1px solid #e2e8f0', backgroundColor: '#fff', cursor: 'pointer', color: '#e53e3e', fontWeight: 'bold' }}>ログアウト</button>
            </div>
          </div>
          
          {!isDataLoaded && <div style={{ padding: '10px', backgroundColor: '#e2e8f0', color: '#2d3748', borderRadius: '4px', marginBottom: '15px' }}>⏳ クラウドからデータを読み込み中...</div>}

          <div style={{ margin: '20px 0', display: 'flex', gap: '10px', flexWrap: 'wrap' }}>
            <button onClick={() => setItems([...items, { id: `file-${Date.now()}`, type: 'file', name: '新規一問一答ファイル', parentId: null, cards: [] }])} style={{ ...btnStyle, backgroundColor: '#3182ce', color: 'white' }}>＋ 新規ファイル</button>
            <button onClick={() => setItems([...items, { id: `folder-${Date.now()}`, type: 'folder', name: '新規フォルダ', parentId: null, cards: [] }])} style={{ ...btnStyle, backgroundColor: '#718096', color: 'white' }}>＋ 新規フォルダ</button>
            <button onClick={() => setIsRoomDeleteMode(!isRoomDeleteMode)} style={{ ...btnStyle, backgroundColor: isRoomDeleteMode ? '#e53e3e' : '#cbd5e0', color: isRoomDeleteMode ? '#fff' : '#2d3748' }}>
              {isRoomDeleteMode ? '完了' : '🗑 削除モード'}
            </button>
          </div>

          <div onDrop={(e) => { e.preventDefault(); const id = e.dataTransfer.getData('itemId'); setItems(items.map(item => item.id === id ? { ...item, parentId: null } : item)); setDragOverRoomId(null) }} onDragOver={(e) => e.preventDefault()} style={{ minHeight: '400px', backgroundColor: isDarkMode ? '#2d3748' : '#f7fafc', padding: '20px', borderRadius: '8px', border: '1px solid #e2e8f0' }}>
            <div onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverRoomId(null); const draggedId = e.dataTransfer.getData('itemId'); if(!draggedId)return; const draggedIndex = items.findIndex(i => i.id === draggedId); const draggedItem = items[draggedIndex]; const newItems = [...items]; newItems.splice(draggedIndex, 1); draggedItem.parentId = null; newItems.unshift(draggedItem); setItems(newItems); }} onDragOver={(e) => { e.preventDefault(); setDragOverRoomId('root-top') }} onDragLeave={() => setDragOverRoomId(null)} style={{ padding: '8px', color: '#a0aec0', fontSize: '0.8rem', fontStyle: 'italic', borderBottom: dragOverRoomId === 'root-top' ? '3px solid #3182ce' : 'none' }}>↓ ここにドロップして一番上に移動</div>
            
            {/* ★ 階層化・フォルダ入れ・並び替えを復活させた部分 */}
            {(() => {
              const renderTree = (parentId: string | null, level: number = 0) => {
                return items.filter(i => i.parentId === parentId).map(item => (
                  <div key={item.id} style={{ marginLeft: level > 0 ? '24px' : '0', marginTop: '8px' }}>
                    <div draggable={editingItemId !== item.id} onDragStart={(e) => { e.dataTransfer.setData('itemId', item.id); e.stopPropagation() }} onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverRoomId(null); const draggedId = e.dataTransfer.getData('itemId'); if(draggedId === item.id) return; let currentParent: string | null = item.id; while(currentParent){ if(currentParent === draggedId) return; currentParent = items.find(i=>i.id === currentParent)?.parentId || null; } const draggedIndex = items.findIndex(i => i.id === draggedId); const draggedItem = items[draggedIndex]; const newItems = [...items]; newItems.splice(draggedIndex, 1); const targetItem = newItems.find(i => i.id === item.id); if(targetItem){ draggedItem.parentId = targetItem.parentId; const targetIndex = newItems.findIndex(i => i.id === item.id); newItems.splice(targetIndex + 1, 0, draggedItem); } setItems(newItems); }} onDragOver={(e) => { e.preventDefault(); setDragOverRoomId(item.id) }} onDragLeave={() => setDragOverRoomId(null)} onClick={() => { if (item.type === 'file' && editingItemId !== item.id) { setActiveFileId(item.id); setCurrentScreen('editor') } }} 
                      style={{ padding: '12px 16px', border: '1px solid #cbd5e0', borderRadius: '6px', 
                        backgroundColor: item.type === 'folder' ? '#edf2f7' : '#ffffff', color: '#2d3748', 
                        cursor: editingItemId === item.id ? 'text' : (item.type === 'file' ? 'pointer' : 'grab'), display: 'flex', alignItems: 'center', boxShadow: '0 1px 2px rgba(0,0,0,0.05)', fontWeight: item.type === 'folder' ? 'bold' : 'normal', borderBottom: dragOverRoomId === item.id ? '3px solid #3182ce' : '1px solid #cbd5e0' }}>
                      <span style={{ marginRight: '8px', fontSize: '1.2rem' }}>{item.type === 'folder' ? '📁' : '📄'}</span>
                      {editingItemId === item.id ? <input autoFocus defaultValue={item.name} onBlur={(e) => { setItems(items.map(i => i.id === item.id ? { ...i, name: e.target.value } : i)); setEditingItemId(null) }} onKeyDown={(e) => { if (e.key === 'Enter') { setItems(items.map(i => i.id === item.id ? { ...i, name: e.currentTarget.value } : i)); setEditingItemId(null) } }} onClick={(e) => e.stopPropagation()} style={{ fontSize: '1rem', padding: '4px', borderRadius: '4px', border: '2px solid #3182ce', outline: 'none', color: '#2d3748' }} /> : <span onDoubleClick={(e) => { e.stopPropagation(); setEditingItemId(item.id) }} style={{ flexGrow: 1 }}>{item.name}</span>}
                      
                      {isRoomDeleteMode && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (window.confirm(`「${item.name}」を削除しますか？\n※フォルダの場合は中身もすべて削除されます`)) {
                              const idsToDelete = new Set([item.id]);
                              let currentSize = 0;
                              while (idsToDelete.size > currentSize) {
                                currentSize = idsToDelete.size;
                                items.forEach(i => { if (i.parentId && idsToDelete.has(i.parentId)) idsToDelete.add(i.id); });
                              }
                              setItems(items.filter(i => !idsToDelete.has(i.id)));
                            }
                          }}
                          style={{ marginLeft: '10px', backgroundColor: '#fff', color: '#e53e3e', border: '2px solid #e53e3e', borderRadius: '50%', width: '28px', height: '28px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px', flexShrink: 0 }}
                        >
                          ✕
                        </button>
                      )}
                    </div>
                    {item.type === 'folder' && <div style={{ borderLeft: '2px dashed #cbd5e0', marginLeft: '12px', paddingLeft: '4px' }}>{renderTree(item.id, level + 1)}<div onDrop={(e) => { e.preventDefault(); e.stopPropagation(); setDragOverRoomId(null); const draggedId = e.dataTransfer.getData('itemId'); if(draggedId === item.id) return; let currentParent: string | null = item.id; while(currentParent){ if(currentParent === draggedId) return; currentParent = items.find(i=>i.id === currentParent)?.parentId || null; } const draggedIndex = items.findIndex(i => i.id === draggedId); const draggedItem = items[draggedIndex]; const newItems = [...items]; newItems.splice(draggedIndex, 1); draggedItem.parentId = item.id; newItems.push(draggedItem); setItems(newItems); }} onDragOver={(e) => { e.preventDefault(); setDragOverRoomId(`empty-${item.id}`) }} onDragLeave={() => setDragOverRoomId(null)} style={{ padding: '8px', color: '#a0aec0', fontSize: '0.8rem', fontStyle: 'italic', borderBottom: dragOverRoomId === `empty-${item.id}` ? '3px solid #3182ce' : 'none' }}>↓ ここにドロップしてフォルダの中に入れる</div></div>}
                  </div>
                ))
              }
              return renderTree(null);
            })()}
          </div>
        </div>
      ) : 

      // --- エディタ画面 ---
      (
        <div style={{ maxWidth: isMobileView ? '430px' : '1400px', margin: '0 auto', padding: '20px', fontFamily: '"Zen Maru Gothic", sans-serif', transition: 'max-width 0.3s' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', gap: '10px', flexWrap: 'wrap' }}>
            <button onClick={() => setCurrentScreen('room')} style={{ ...btnStyle, backgroundColor: '#e2e8f0' }}>← 部屋に戻る</button>
            {editingItemId === activeFileId ? (
              <input autoFocus defaultValue={activeFile?.name} onBlur={(e) => { setItems(items.map(i => i.id === activeFileId ? { ...i, name: e.target.value } : i)); setEditingItemId(null) }} onKeyDown={(e) => { if (e.key === 'Enter') { setItems(items.map(i => i.id === activeFileId ? { ...i, name: e.currentTarget.value } : i)); setEditingItemId(null) } }} style={{ fontSize: '1.5rem', fontWeight: 900, padding: '4px', borderRadius: '4px', border: '2px solid #3182ce', outline: 'none', maxWidth: '200px', color: '#2d3748', fontFamily: '"Zen Maru Gothic", sans-serif' }} />
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
                <div onPaste={handleStockPaste} onDrop={handleStockFileDrop} onDragOver={(e) => e.preventDefault()} tabIndex={0} style={{ width: '100%', boxSizing: 'border-box', backgroundColor: '#e2e8f0', color: '#2d3748', border: '2px dashed #a0aec0', borderRadius: '8px', padding: '15px', marginBottom: '20px', outline: 'none' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}><strong style={{ fontSize: '0.9rem' }}>スクショ箱 (ペースト・ドロップ)</strong><button onClick={() => { if(window.confirm('スクショ箱の画像をすべて削除しますか？')) setStockImages([]) }} style={{ ...miniBtnStyle, color: '#e53e3e' }}>一括削除</button></div>
                  <div style={{ display: 'flex', gap: '10px', overflowX: 'auto', minHeight: '80px', paddingBottom: '10px' }}>
                    {stockImages.map(img => (
                      <div key={img.id} style={{ position: 'relative', width: '150px', flexShrink: 0, backgroundColor: '#fff', padding: '4px', borderRadius: '4px', boxShadow: '0 1px 2px rgba(0,0,0,0.1)' }}>
                        <button onClick={() => setStockImages(s => s.filter(x => x.id !== img.id))} style={{ position: 'absolute', top: -5, right: -5, background: 'red', color: 'white', border: 'none', borderRadius: '50%', width: '20px', height: '20px', cursor: 'pointer', fontSize: '10px' }}>×</button>
                        <img src={img.src} draggable onDragStart={(e) => e.dataTransfer.setData('stockImage', img.src)} style={{ width: '100%', cursor: 'grab', borderRadius: '2px' }} alt="" />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!isTestMode && (
                <div style={{ backgroundColor: 'white', color: '#2d3748', padding: '20px', borderRadius: '8px', marginBottom: '30px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)', width: '100%', boxSizing: 'border-box' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '15px', flexWrap: 'wrap', gap: '10px' }}>
                    <h3 style={{ margin: 0, fontSize: '1.1rem', color: '#4a5568' }}>{editingCardId ? 'カード編集' : '新規追加'}</h3>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', fontSize: '0.9rem' }}><label>文字サイズ:</label><input type="range" min="5" max="32" value={fontSize} onChange={(e) => setFontSize(Number(e.target.value))} /><span>{fontSize}px</span></div>
                  </div>
                  <RichToolbar hasSelection={hasSelection} />
                  <div style={{ display: 'grid', gridTemplateColumns: isMobileView ? '1fr' : '390px 390px', gap: '20px', marginBottom: '15px', justifyContent: 'center', width: '100%' }}>
                    <div style={{ ...(createExpanded === 'q' ? expandedQStyle : {}) } as React.CSSProperties}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', alignItems: 'center' }}>
                        <strong style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>問題{createExpanded === 'q' && <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.8rem', marginLeft: '10px' }}>文字: <input type="range" min="5" max="32" value={tempCreateFontSize} onChange={(e) => setTempCreateFontSize(Number(e.target.value))} /> {tempCreateFontSize}px</div>}<button onClick={() => setCreateExpanded(createExpanded === 'q' ? 'none' : 'q')} style={expandBtnStyleBig}>{createExpanded === 'q' ? '縮小 ⤡' : '拡大 ⤢'}</button></strong>
                        <button onClick={() => handleFloatingImageInsertBtn(true)} style={miniBtnStyle}>🖼 画像</button>
                      </div>
                      <div style={innerInputStyle(createExpanded === 'q')}>
                        {renderNewImages(qImages, true)}
                        <div ref={questionRef} contentEditable className="rich-text-content" onDrop={(e) => handleDropFromStock(e, true)} onDragOver={(e) => e.preventDefault()} style={{ flex: 1, minHeight: '100px', outline: 'none', fontSize: `${createExpanded === 'q' ? tempCreateFontSize : fontSize}px` }} />
                      </div>
                    </div>
                    <div style={{ ...(createExpanded === 'a' ? expandedAStyle : {}) } as React.CSSProperties}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px', alignItems: 'center' }}>
                        <strong style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>解答{createExpanded === 'a' && <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '0.8rem', marginLeft: '10px' }}>文字: <input type="range" min="5" max="32" value={tempCreateFontSize} onChange={(e) => setTempCreateFontSize(Number(e.target.value))} /> {tempCreateFontSize}px</div>}<button onClick={() => setCreateExpanded(createExpanded === 'a' ? 'none' : 'a')} style={expandBtnStyleBig}>{createExpanded === 'a' ? '縮小 ⤡' : '拡大 ⤢'}</button></strong>
                        <button onClick={() => handleFloatingImageInsertBtn(false)} style={miniBtnStyle}>🖼 画像</button>
                      </div>
                      <div style={innerInputStyle(createExpanded === 'a')}>
                        {renderNewImages(aImages, false)}
                        <div ref={answerRef} contentEditable className="rich-text-content" onDrop={(e) => handleDropFromStock(e, false)} onDragOver={(e) => e.preventDefault()} style={{ flex: 1, minHeight: '100px', outline: 'none', fontSize: `${createExpanded === 'a' ? tempCreateFontSize : fontSize}px` }} />
                      </div>
                    </div>
                  </div>
                  <button onClick={() => {
                    const qHTML = questionRef.current?.innerHTML || ''; const aHTML = answerRef.current?.innerHTML || ''
                    if (!qHTML.trim() && !aHTML.trim() && qImages.length === 0 && aImages.length === 0) return alert('入力してください。')
                    if (editingCardId) { setItems(items.map(i => i.id === activeFileId ? { ...i, cards: i.cards.map(c => c.id === editingCardId ? { ...c, question: qHTML, answer: aHTML, qImages: [...qImages], aImages: [...aImages], fontSize } : c) } : i)); setEditingCardId(null); }
                    else { const newCard: Card = { id: Date.now().toString(), question: qHTML, answer: aHTML, qImages: [...qImages], aImages: [...aImages], fontSize }; setItems(items.map(i => i.id === activeFileId ? { ...i, cards: [...i.cards, newCard] } : i)) }
                    if (questionRef.current) questionRef.current.innerHTML = ''; if (answerRef.current) answerRef.current.innerHTML = ''; setQImages([]); setAImages([])
                  }} style={{ ...btnStyle, backgroundColor: editingCardId ? '#d69e2e' : '#3182ce', color: 'white', width: '100%', padding: '10px' }}>{editingCardId ? '更新する' : 'カードを追加'}</button>
                  {createExpanded !== 'none' && <div onClick={() => setCreateExpanded('none')} style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)', zIndex: 9998 }} />}
                </div>
              )}

              <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={(e) => { const { active, over } = e; if (over && active.id !== over.id && activeFile) { const updatedCards = arrayMove(activeFile.cards, activeFile.cards.findIndex(c => c.id === active.id), activeFile.cards.findIndex(c => c.id === over.id)); setItems(items.map(i => i.id === activeFile.id ? { ...i, cards: updatedCards } : i)) } }}>
                <SortableContext items={activeFile?.cards.map(c => c.id) || []} strategy={verticalListSortingStrategy}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                    {activeFile?.cards.map((card, index) => <SortableCard key={card.id} card={card} index={index + 1} isTestMode={isTestMode} isEditMode={isEditMode} fontSize={fontSize} isMobileView={isMobileView} onDelete={(id) => setItems(items.map(i => i.id === activeFileId ? { ...i, cards: i.cards.filter(c => c.id !== id) } : i))} onUpdate={(updatedCard) => setItems(items.map(i => i.id === activeFileId ? { ...i, cards: i.cards.map(c => c.id === updatedCard.id ? updatedCard : c) } : i))} onEdit={(c)=>{ setEditingCardId(c.id); setFontSize(c.fontSize || 16); if (questionRef.current) questionRef.current.innerHTML = c.question; if (answerRef.current) answerRef.current.innerHTML = c.answer; setQImages([...c.qImages]); setAImages([...c.aImages]); window.scrollTo({ top: 0, behavior: 'smooth' }); }} />)}
                  </div>
                </SortableContext>
              </DndContext>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const btnStyle = { padding: '8px 16px', borderRadius: '6px', border: '1px solid #cbd5e0', backgroundColor: '#ffffff', cursor: 'pointer', fontWeight: 'bold' as const, color: '#2d3748' }
const miniBtnStyle = { padding: '4px 8px', fontSize: '0.8rem', borderRadius: '4px', border: '1px solid #ccc', cursor: 'pointer', backgroundColor: '#f7fafc', fontWeight: 'bold' as const, color: '#2d3748' }
const expandBtnStyleBig = { padding: '8px 16px', fontSize: '1rem', borderRadius: '6px', border: '2px solid #a0aec0', cursor: 'pointer', backgroundColor: '#edf2f7', fontWeight: 'bold' as const, color: '#2d3748' }
const baseInputStyle = { fontFamily: 'sans-serif', position: 'relative' as const, height: '250px', width: '100%', minWidth: '0', maxWidth: '100%', border: '1px solid #cbd5e0', /* ...以下略 */ }
const expandedQStyle = { position: 'fixed', top: 0, left: 0, width: '50vw', height: '100vh', zIndex: 10000, padding: '40px', boxShadow: '4px 0 15px rgba(0,0,0,0.2)', backgroundColor: '#fff', display: 'flex', flexDirection: 'column' as const, boxSizing: 'border-box' as const, color: '#2d3748' }
const expandedAStyle = { position: 'fixed', top: 0, right: 0, width: '50vw', height: '100vh', zIndex: 10000, padding: '40px', boxShadow: '-4px 0 15px rgba(0,0,0,0.2)', backgroundColor: '#fff', display: 'flex', flexDirection: 'column' as const, boxSizing: 'border-box' as const, color: '#2d3748' }
const innerInputStyle = (isExpanded: boolean) => ({ ...(isExpanded ? { flex: 1, height: '100%', width: '100%', border: '1px solid #e2e8f0', padding: '10px', overflowX: 'auto' as const, overflowY: 'auto' as const, position: 'relative' as const, whiteSpace: 'pre' as const, boxSizing: 'border-box' as const, textAlign: 'left' as const, color: '#2d3748', fontFamily: 'sans-serif', display: 'flex', flexDirection: 'column' } : baseInputStyle) } as React.CSSProperties)