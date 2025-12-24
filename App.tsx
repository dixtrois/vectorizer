
import React, { useState, useRef, useEffect, useCallback } from 'react';
import { 
  Upload, 
  Layers, 
  Droplet, 
  Contrast, 
  Download, 
  Trash2, 
  Maximize2,
  Settings,
  Image as ImageIcon,
  Loader2,
  Activity,
  Columns,
  Square
} from 'lucide-react';
import { ProcessingSettings, ImageData, CurvePoint, CurveChannel } from './types';
import { runKMeans, blendImages, applyMultiChannelCurves, getCurveLUT } from './utils/imageProcessing';

const App: React.FC = () => {
  const [image, setImage] = useState<ImageData | null>(null);
  const [activeChannel, setActiveChannel] = useState<CurveChannel>('red'); // Passage sur le canal Rouge par défaut
  const [isSplitMode, setIsSplitMode] = useState(true);
  const [splitPos, setSplitPos] = useState(50);
  
  const [settings, setSettings] = useState<ProcessingSettings>({
    levels: 10,
    opacity: 50,
    isBlackAndWhite: false,
    curves: {
      all: [{ x: 0, y: 0 }, { x: 255, y: 255 }],
      // Courbe Stencil Professionnelle : Noirs profonds et Blancs éclatants
      red: [
        { x: 0, y: 0 }, 
        { x: 65, y: 15 }, 
        { x: 190, y: 240 }, 
        { x: 255, y: 255 }
      ],
    }
  });

  const [localCurves, setLocalCurves] = useState(settings.curves);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isInteracting, setIsInteracting] = useState(false);
  const [processedUrl, setProcessedUrl] = useState<string | null>(null);
  const [curvedOnlyUrl, setCurvedOnlyUrl] = useState<string | null>(null);
  const [draggingPointIndex, setDraggingPointIndex] = useState<number | null>(null);
  
  const offscreenCanvasRef = useRef<HTMLCanvasElement>(document.createElement('canvas'));
  const splitRef = useRef<HTMLDivElement>(null);
  const curveRef = useRef<SVGSVGElement>(null);
  const processingTimerRef = useRef<number | null>(null);

  const handleUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = offscreenCanvasRef.current;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;

        const maxDim = 1200;
        let w = img.width;
        let h = img.height;
        if (w > maxDim || h > maxDim) {
          if (w > h) {
            h = (maxDim / w) * h;
            w = maxDim;
          } else {
            w = (maxDim / h) * w;
            h = maxDim;
          }
        }

        canvas.width = w;
        canvas.height = h;
        ctx.drawImage(img, 0, 0, w, h);
        const pixelData = ctx.getImageData(0, 0, w, h).data;

        setImage({
          url: event.target?.result as string,
          width: w,
          height: h,
          originalPixels: pixelData
        });
        setProcessedUrl(null);
        setCurvedOnlyUrl(null);
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const processImage = useCallback((quality: 'low' | 'high' = 'high') => {
    if (!image || !image.originalPixels) return;
    
    if (quality === 'high') setIsProcessing(true);
    
    setTimeout(() => {
      const curvesToUse = isInteracting ? localCurves : settings.curves;
      const { levels, opacity, isBlackAndWhite } = settings;
      
      const luts = {
        all: getCurveLUT(curvesToUse.all),
        red: getCurveLUT(curvesToUse.red),
      };

      // 1. Appliquer les courbes (Le "Avant")
      const curvedPixels = applyMultiChannelCurves(image.originalPixels!, luts);
      
      // 2. Vectoriser (Le "Après")
      const simplified = runKMeans(curvedPixels, levels, isBlackAndWhite, quality);
      const finalPixels = blendImages(curvedPixels, simplified, opacity, isBlackAndWhite);
      
      const canvas = offscreenCanvasRef.current;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        const curvedData = new ImageData(curvedPixels, image.width, image.height);
        ctx.putImageData(curvedData, 0, 0);
        setCurvedOnlyUrl(canvas.toDataURL('image/jpeg', 0.8));

        const finalData = new ImageData(finalPixels, image.width, image.height);
        ctx.putImageData(finalData, 0, 0);
        setProcessedUrl(canvas.toDataURL('image/png'));
      }
      
      if (quality === 'high') setIsProcessing(false);
    }, 0);
  }, [image, settings, localCurves, isInteracting]);

  useEffect(() => {
    setLocalCurves(settings.curves);
  }, [settings.curves]);

  useEffect(() => {
    if (image && !isInteracting) {
      processImage('high');
    }
  }, [settings.levels, settings.isBlackAndWhite, settings.opacity, settings.curves, image, isInteracting, processImage]);

  useEffect(() => {
    if (image && isInteracting) {
      if (processingTimerRef.current) return;
      processingTimerRef.current = window.setTimeout(() => {
        processImage('low');
        processingTimerRef.current = null;
      }, 40);
    }
  }, [localCurves, image, isInteracting, processImage]);

  const handleDownload = () => {
    if (!processedUrl) return;
    const link = document.createElement('a');
    link.download = `tattookonex-vector-${Date.now()}.png`;
    link.href = processedUrl;
    link.click();
  };

  const handleCurveInteraction = (e: React.MouseEvent | React.TouchEvent) => {
    if (!curveRef.current) return;
    const svg = curveRef.current;
    const rect = svg.getBoundingClientRect();
    const clientX = 'touches' in e ? (e as React.TouchEvent).touches[0].clientX : (e as React.MouseEvent).clientX;
    const clientY = 'touches' in e ? (e as React.TouchEvent).touches[0].clientY : (e as React.MouseEvent).clientY;
    const x = Math.max(0, Math.min(255, Math.round(((clientX - rect.left) / rect.width) * 255)));
    const y = Math.max(0, Math.min(255, Math.round((1 - (clientY - rect.top) / rect.height) * 255)));

    if (e.type === 'mousedown' || e.type === 'touchstart') {
      setIsInteracting(true);
      const activePoints = localCurves[activeChannel];
      const index = activePoints.findIndex(p => Math.abs(p.x - x) < 15 && Math.abs(p.y - y) < 15);
      if (index !== -1) {
        setDraggingPointIndex(index);
      } else {
        const newPoints = [...activePoints, { x, y }].sort((a, b) => a.x - b.x);
        setLocalCurves(prev => ({ ...prev, [activeChannel]: newPoints }));
        setDraggingPointIndex(newPoints.findIndex(p => p.x === x && p.y === y));
      }
    } else if ((e.type === 'mousemove' || e.type === 'touchmove') && draggingPointIndex !== null) {
      const activePoints = localCurves[activeChannel];
      const newPoints = [...activePoints];
      if (draggingPointIndex === 0) newPoints[draggingPointIndex] = { x: 0, y };
      else if (draggingPointIndex === activePoints.length - 1) newPoints[draggingPointIndex] = { x: 255, y };
      else newPoints[draggingPointIndex] = { x, y };
      const sorted = newPoints.sort((a, b) => a.x - b.x);
      setLocalCurves(prev => ({ ...prev, [activeChannel]: sorted }));
    }
  };

  const endInteraction = () => {
    if (!isInteracting) return;
    setDraggingPointIndex(null);
    setIsInteracting(false);
    setSettings(prev => ({ ...prev, curves: localCurves }));
  };

  const handleSplitDrag = (e: React.MouseEvent | React.TouchEvent) => {
    if (!splitRef.current) return;
    const rect = splitRef.current.getBoundingClientRect();
    const clientX = 'touches' in e ? (e as React.TouchEvent).touches[0].clientX : (e as React.MouseEvent).clientX;
    const pos = ((clientX - rect.left) / rect.width) * 100;
    setSplitPos(Math.max(0, Math.min(100, pos)));
  };

  const getChannelColor = (channel: CurveChannel) => {
    switch (channel) {
      case 'red': return '#f43f5e';
      default: return '#ffffff';
    }
  };

  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-[#0a0a0a]" 
         onMouseUp={endInteraction} 
         onMouseLeave={endInteraction} 
         onTouchEnd={endInteraction}>
      
      <aside className="w-full md:w-80 bg-[#121212] border-r border-[#262626] p-6 flex flex-col gap-6 z-20 overflow-y-auto max-h-screen">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-white text-black rounded-lg">
            <Layers size={24} />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-white leading-none tracking-tighter">TATTOOKONEX</h1>
            <p className="text-[10px] text-zinc-500 font-medium uppercase tracking-[0.2em] mt-1 text-nowrap">Vectorizer Studio v1.3</p>
          </div>
        </div>

        <section>
          {!image ? (
            <label className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed border-[#262626] rounded-xl cursor-pointer hover:bg-[#1a1a1a] hover:border-zinc-600 transition-all group">
              <Upload className="text-zinc-500 mb-1 group-hover:text-white transition-colors" size={20} />
              <span className="text-xs text-zinc-400 group-hover:text-zinc-200">Importer Photo</span>
              <input type="file" className="hidden" accept="image/*" onChange={handleUpload} />
            </label>
          ) : (
            <div className="relative group rounded-xl overflow-hidden border border-[#262626]">
              <img src={image.url} alt="Original" className={`w-full h-20 object-cover opacity-60 transition-all ${settings.isBlackAndWhite ? 'grayscale' : ''}`} />
              <button onClick={() => setImage(null)} className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity text-white">
                <Trash2 size={16} />
              </button>
            </div>
          )}
        </section>

        <section className={`space-y-3 ${!image ? 'opacity-30 pointer-events-none' : ''}`}>
          <div className="flex justify-between items-center">
            <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-2">
              <Activity size={14} /> Courbe
            </label>
            <button 
              onClick={() => {
                const resetCurves = { ...settings.curves, [activeChannel]: [{ x: 0, y: 0 }, { x: 255, y: 255 }] };
                setSettings(s => ({ ...s, curves: resetCurves }));
                setLocalCurves(resetCurves);
              }}
              className="text-[10px] text-zinc-500 hover:text-white uppercase transition-colors"
            >
              Reset
            </button>
          </div>

          <div className="flex bg-[#1a1a1a] p-1 rounded-lg border border-[#262626] gap-1">
            {(['all', 'red'] as CurveChannel[]).map((c) => (
              <button
                key={c}
                onMouseDown={() => setActiveChannel(c)}
                className={`flex-1 py-1.5 rounded-md text-[10px] font-bold uppercase transition-all ${
                  activeChannel === c ? 'bg-zinc-800 text-white shadow-sm' : 'text-zinc-500 hover:text-zinc-300'
                }`}
                style={{ borderBottom: activeChannel === c ? `2px solid ${getChannelColor(c)}` : 'none' }}
              >
                {c === 'all' ? 'RGB' : 'R'}
              </button>
            ))}
          </div>
          
          <div className="relative aspect-square w-full bg-[#0a0a0a] rounded-xl border border-[#262626] overflow-hidden group shadow-inner">
            <div className="absolute inset-0 grid grid-cols-4 grid-rows-4 pointer-events-none opacity-10">
              {[...Array(3)].map((_, i) => (
                <React.Fragment key={i}>
                  <div className="border-r border-zinc-500" style={{ gridRow: '1 / -1', gridColumn: i + 2 }} />
                  <div className="border-b border-zinc-500" style={{ gridColumn: '1 / -1', gridRow: i + 2 }} />
                </React.Fragment>
              ))}
            </div>

            <svg 
              ref={curveRef}
              viewBox="0 0 255 255" 
              className="absolute inset-0 w-full h-full cursor-crosshair touch-none select-none"
              onMouseDown={handleCurveInteraction}
              onMouseMove={handleCurveInteraction}
              onTouchStart={handleCurveInteraction}
              onTouchMove={handleCurveInteraction}
            >
              <polyline points={localCurves[activeChannel].map(p => `${p.x},${255 - p.y}`).join(' ')} fill="none" stroke={getChannelColor(activeChannel)} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="pointer-events-none" />
              {localCurves[activeChannel].map((p, i) => (
                <circle key={i} cx={p.x} cy={255 - p.y} r={draggingPointIndex === i ? "8" : "6"} fill={draggingPointIndex === i ? getChannelColor(activeChannel) : "#121212"} stroke={getChannelColor(activeChannel)} strokeWidth="2" className="cursor-pointer transition-all duration-75" />
              ))}
            </svg>
          </div>
          <p className="text-[10px] text-zinc-600 italic leading-tight px-1">Réglage des contrastes en temps réel.</p>
        </section>

        <div className={`space-y-6 ${!image ? 'opacity-30 pointer-events-none' : ''}`}>
          <section>
            <button 
              onClick={() => setSettings(prev => ({ ...prev, isBlackAndWhite: !prev.isBlackAndWhite }))}
              className={`w-full flex items-center justify-between p-3 rounded-xl border transition-all ${
                settings.isBlackAndWhite ? 'bg-white text-black border-white shadow-lg' : 'bg-[#1a1a1a] text-zinc-400 border-[#262626]'
              }`}
            >
              <span className="text-xs font-bold flex items-center gap-2"><Contrast size={16} /> Mode Noir & Blanc</span>
              <div className={`w-8 h-4 rounded-full relative transition-colors ${settings.isBlackAndWhite ? 'bg-black' : 'bg-[#262626]'}`}>
                 <div className={`absolute top-0.5 w-3 h-3 rounded-full transition-all ${settings.isBlackAndWhite ? 'right-0.5 bg-white' : 'left-0.5 bg-zinc-600'}`} />
              </div>
            </button>
          </section>

          <section>
            <div className="flex justify-between items-center mb-3">
              <label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-2"><Settings size={14} /> Niveaux de Détails</label>
              <span className="text-xs font-mono text-white bg-zinc-800 px-2 py-0.5 rounded border border-zinc-700">{settings.levels}</span>
            </div>
            <input type="range" min="2" max="20" value={settings.levels} onChange={(e) => setSettings(s => ({ ...s, levels: parseInt(e.target.value) }))} className="w-full h-1" />
          </section>

          <section>
            <div className="flex justify-between items-center mb-3"><label className="text-xs font-semibold text-zinc-400 uppercase tracking-wider flex items-center gap-2"><Droplet size={14} /> Opacité du Calque</label><span className="text-xs font-mono text-white">{settings.opacity}%</span></div>
            <input type="range" min="0" max="100" value={settings.opacity} onChange={(e) => setSettings(s => ({ ...s, opacity: parseInt(e.target.value) }))} className="w-full h-1" />
          </section>

          <button onClick={handleDownload} disabled={!processedUrl || isProcessing} className="w-full py-4 bg-white hover:bg-zinc-100 disabled:bg-zinc-800 disabled:text-zinc-600 text-black font-bold rounded-xl flex items-center justify-center gap-2 transition-all active:scale-95 shadow-xl">
            <Download size={20} /> Exporter le Stencil
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col relative bg-[#0a0a0a] overflow-hidden">
        <header className="md:hidden flex items-center justify-between p-4 bg-[#121212] border-b border-[#262626]">
          <h1 className="text-lg font-bold tracking-tighter">TATTOOKONEX</h1>
        </header>

        <div className="flex-1 flex items-center justify-center p-4 md:p-8">
          {!image ? (
            <div className="text-center animate-in fade-in duration-700">
              <div className="w-20 h-20 rounded-3xl bg-[#121212] border border-[#262626] flex items-center justify-center mx-auto mb-6 text-zinc-600 shadow-2xl"><ImageIcon size={40} /></div>
              <h2 className="text-xl font-light text-zinc-400 mb-2">Prêt pour votre prochain stencil ?</h2>
              <p className="text-xs text-zinc-600 max-w-xs mx-auto">Importez une photo pour commencer la vectorisation.</p>
            </div>
          ) : (
            <div className="relative w-full h-full flex items-center justify-center select-none" ref={splitRef} onMouseMove={(e) => e.buttons === 1 && handleSplitDrag(e)} onTouchMove={handleSplitDrag}>
              <div className="relative max-w-full max-h-full rounded-2xl overflow-hidden shadow-2xl border border-[#262626] bg-[#121212]">
                
                {isProcessing && (
                  <div className="absolute inset-0 bg-black/40 backdrop-blur-sm z-50 flex flex-col items-center justify-center">
                    <Loader2 className="animate-spin text-white mb-2" size={32} />
                    <span className="text-[10px] font-bold tracking-widest uppercase">Calcul...</span>
                  </div>
                )}

                {curvedOnlyUrl && (
                  <img src={curvedOnlyUrl} alt="Curved" className="max-w-full max-h-[80vh] object-contain" />
                )}

                {processedUrl && (
                  <div 
                    className="absolute inset-0 pointer-events-none" 
                    style={{ 
                      clipPath: isSplitMode ? `inset(0 0 0 ${splitPos}%)` : 'none',
                      transition: isInteracting ? 'none' : 'clip-path 0.1s linear'
                    }}
                  >
                    <img src={processedUrl} alt="Vectorized" className="w-full h-full object-contain" />
                  </div>
                )}

                {isSplitMode && processedUrl && (
                  <div 
                    className="absolute inset-y-0 z-30 group cursor-col-resize pointer-events-auto"
                    style={{ left: `${splitPos}%`, transform: 'translateX(-50%)' }}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    <div className="h-full w-0.5 bg-white/50 group-hover:bg-white shadow-[0_0_15px_rgba(0,0,0,0.5)]" />
                    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-8 h-8 bg-white text-black rounded-full flex items-center justify-center shadow-2xl border border-zinc-200">
                      <Columns size={16} />
                    </div>
                  </div>
                )}

                {isSplitMode && (
                  <>
                    <div className="absolute top-6 left-6 px-3 py-1.5 bg-black/60 backdrop-blur-md rounded-lg border border-white/10 text-[9px] font-black uppercase tracking-[0.2em] text-zinc-300">Image + Courbes</div>
                    <div className="absolute top-6 right-6 px-3 py-1.5 bg-white/90 backdrop-blur-md rounded-lg border border-white text-[9px] font-black uppercase tracking-[0.2em] text-black shadow-xl">Vectorisation</div>
                  </>
                )}
              </div>

              <div className="absolute bottom-6 left-1/2 -translate-x-1/2 flex items-center gap-1 p-1.5 bg-[#121212]/90 backdrop-blur-md rounded-2xl border border-[#262626] shadow-2xl z-40">
                 <button 
                   onClick={() => setIsSplitMode(true)}
                   className={`p-2.5 rounded-xl transition-all flex items-center gap-2 px-4 ${isSplitMode ? 'bg-white text-black shadow-lg' : 'text-zinc-500 hover:text-white'}`}
                 >
                   <Columns size={16} /><span className="text-[10px] font-bold uppercase">Split View</span>
                 </button>
                 <button 
                   onClick={() => setIsSplitMode(false)}
                   className={`p-2.5 rounded-xl transition-all flex items-center gap-2 px-4 ${!isSplitMode ? 'bg-white text-black shadow-lg' : 'text-zinc-500 hover:text-white'}`}
                 >
                   <Square size={16} /><span className="text-[10px] font-bold uppercase">Vue Finale</span>
                 </button>
                 <div className="h-4 w-px bg-zinc-800 mx-2" />
                 <div className="px-4 text-[10px] font-mono text-zinc-500 uppercase tracking-widest">{image ? `${image.width} x ${image.height} px` : ''}</div>
              </div>
            </div>
          )}
        </div>
      </main>

      <footer className="fixed bottom-0 left-0 right-0 h-0.5 bg-[#262626] z-50">
        {(isProcessing || isInteracting) && <div className="h-full bg-white loading-pulse w-full" />}
      </footer>
    </div>
  );
};

export default App;
