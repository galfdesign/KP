import React, { useEffect, useMemo, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorkerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import logo from './logo.png'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerSrc as unknown as string

// === Manual Area Tool ===
// Без внешних зависимостей. Стили — через Tailwind-классы.

export default function ManualAreaCalibrator() {
  // Canvas & image
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [imgEl, setImgEl] = useState<HTMLImageElement | null>(null)

  // Viewport (zoom/pan)
  const [viewScale, setViewScale] = useState(1)
  const [viewOffset, setViewOffset] = useState({ x: 0, y: 0 })
  const [isPanning, setIsPanning] = useState(false)
  const panStartRef = useRef<{ x: number; y: number } | null>(null)

  // Modes
  type Mode = 'scale' | 'polygon'
  const [mode, setMode] = useState<Mode>('scale')

  // Calibration line (image coords)
  type Pt = { x: number; y: number }
  const [scalePts, setScalePts] = useState<Pt[]>([])
  const [realLen, setRealLen] = useState<string>("")

  // Polygon (image coords)
  const [poly, setPoly] = useState<Pt[]>([])
  const [isClosed, setIsClosed] = useState(false)
  const [draggingIdx, setDraggingIdx] = useState<number | null>(null)

  // Rotation (in 90° steps)
  const [rot, setRot] = useState(0)

  // Small upload window (modal)
  const [uploaderOpen, setUploaderOpen] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // Fullscreen viewer modal
  const [viewerOpen, setViewerOpen] = useState(false)
  // Keep original uploaded file for AI analysis
  const [currentFile, setCurrentFile] = useState<File | null>(null)
  // PDF document state
  const pdfDocRef = useRef<any | null>(null)
  const [pdfPageNum, setPdfPageNum] = useState<number>(1)
  const [pdfPageCount, setPdfPageCount] = useState<number>(0)

  // Results aggregation
  const [currentFileName, setCurrentFileName] = useState<string | null>(null)
  const [results, setResults] = useState<{ id: number; fileName: string; areaM2: number; scaleMmPerPx?: number; savedAt: number }[]>([])
  const [resultWidth, setResultWidth] = useState<number>(400)
  const totalAreaM2 = useMemo(() => results.reduce((sum, r) => sum + (r.areaM2 || 0), 0), [results])
  const totalAreaM2Rounded = useMemo(() => Math.round(totalAreaM2), [totalAreaM2])
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [prices, setPrices] = useState<{
    heatingWaterBoiler: number
    sewerage: number
    ventilation: number
    conditioning: number
    electrical: number
  }>({ heatingWaterBoiler: 200, sewerage: 60, ventilation: 140, conditioning: 140, electrical: 240 })
  const [enabled, setEnabled] = useState<{
    heatingWaterBoiler: boolean
    sewerage: boolean
    ventilation: boolean
    conditioning: boolean
    electrical: boolean
  }>({ heatingWaterBoiler: true, sewerage: true, ventilation: true, conditioning: true, electrical: true })
  const totalPricePerM2 = useMemo(
    () =>
      (enabled.heatingWaterBoiler ? prices.heatingWaterBoiler : 0) +
      (enabled.sewerage ? prices.sewerage : 0) +
      (enabled.ventilation ? prices.ventilation : 0) +
      (enabled.conditioning ? prices.conditioning : 0) +
      (enabled.electrical ? prices.electrical : 0),
    [prices, enabled]
  )
  const estimatedCost = useMemo(() => totalAreaM2Rounded * totalPricePerM2, [totalAreaM2Rounded, totalPricePerM2])
  const updatePrice = (key: keyof typeof prices, value: string) => {
    const num = Number(value)
    setPrices(prev => ({ ...prev, [key]: isFinite(num) ? num : 0 }))
  }

  const sectionCosts = useMemo(() => {
    const minFor = (key: string) => (key === 'electrical' ? 35000 : 25000)
    const makeCost = (key: string, price: number) => {
      const base = totalAreaM2Rounded * price
      if (totalAreaM2Rounded <= 0) return 0
      if (key === 'sewerage') return base
      return Math.max(base, minFor(key))
    }
    const items = [
      { key: 'heatingWaterBoiler', title: 'Системы отопления, водоснабжения, котельная (сумма)', price: prices.heatingWaterBoiler, enabled: enabled.heatingWaterBoiler, cost: makeCost('heatingWaterBoiler', prices.heatingWaterBoiler) },
      { key: 'sewerage', title: 'Канализация', price: prices.sewerage, enabled: enabled.sewerage, cost: makeCost('sewerage', prices.sewerage) },
      { key: 'ventilation', title: 'Вентиляция', price: prices.ventilation, enabled: enabled.ventilation, cost: makeCost('ventilation', prices.ventilation) },
      { key: 'conditioning', title: 'Кондиционирование', price: prices.conditioning, enabled: enabled.conditioning, cost: makeCost('conditioning', prices.conditioning) },
      { key: 'electrical', title: 'Электрические сети', price: prices.electrical, enabled: enabled.electrical, cost: makeCost('electrical', prices.electrical) },
    ] as const
    return items.filter(it => it.enabled)
  }, [prices, enabled, totalAreaM2Rounded])

  // Общая стоимость с учётом минимальной цены раздела (кроме канализации)
  const estimatedCostFinal = useMemo(() => {
    if (totalAreaM2Rounded <= 0) return 0
    return sectionCosts.reduce((sum, s) => sum + s.cost, 0)
  }, [sectionCosts, totalAreaM2Rounded])

  // Разделы, которых нет в КП (выключены)
  const disabledSections = useMemo(() => {
    const all = [
      { key: 'heatingWaterBoiler', title: 'Системы отопления, водоснабжения, котельная (сумма)', price: prices.heatingWaterBoiler, enabled: enabled.heatingWaterBoiler },
      { key: 'sewerage', title: 'Канализация', price: prices.sewerage, enabled: enabled.sewerage },
      { key: 'ventilation', title: 'Вентиляция', price: prices.ventilation, enabled: enabled.ventilation },
      { key: 'conditioning', title: 'Кондиционирование', price: prices.conditioning, enabled: enabled.conditioning },
      { key: 'electrical', title: 'Электрические сети', price: prices.electrical, enabled: enabled.electrical },
    ] as const
    return all.filter(it => !it.enabled)
  }, [prices, enabled])

  const disabledSectionLines = useMemo(() => {
    const fmtMoney = (v: number) => new Intl.NumberFormat('ru-RU').format(Number(v.toFixed(2)))
    return disabledSections.map(s => {
      const base = totalAreaM2Rounded * s.price
      const min = s.key === 'electrical' ? 35000 : 25000
      const cost = (totalAreaM2Rounded > 0 && s.key !== 'sewerage') ? Math.max(base, min) : base
      return `${s.title}: ${fmtMoney(s.price)} ₽/м² → за ${totalAreaM2Rounded} м² = ${fmtMoney(cost)} ₽`
    })
  }, [disabledSections, totalAreaM2Rounded])

  // Text for messengers (КП)
  const [proposalDetailed, setProposalDetailed] = useState(false)
  const proposalText = useMemo(() => {
    const fmtMoney = (v: number) => new Intl.NumberFormat('ru-RU').format(Number(v.toFixed(2)))
    const lines: string[] = []
    const sep = '────────────────────────────────'
    lines.push('КП на проектирование инженерных систем')
    lines.push(sep)
    lines.push(`Дата: ${new Date().toLocaleDateString('ru-RU')}`)
    lines.push('')
    lines.push(`Отапливаемая площадь: ${totalAreaM2Rounded} м²`)
    lines.push(`Цена за м² (сумма): ${fmtMoney(totalPricePerM2)} ₽/м²`)
    lines.push(`Итого к оплате: ${fmtMoney(estimatedCostFinal)} ₽`)
    if (sectionCosts.length) {
      lines.push('')
      lines.push('Детализация по разделам:')
      sectionCosts.forEach(s => {
        if (proposalDetailed) {
          const base = totalAreaM2Rounded * s.price
          const min = s.key === 'electrical' ? 35000 : 25000
          const minNote = s.key !== 'sewerage' && totalAreaM2Rounded > 0 && base < min ? ` (мин. ${fmtMoney(min)} ₽)` : ''
          lines.push(`• ${s.title} — ${totalAreaM2Rounded} м² × ${fmtMoney(s.price)} ₽/м² = ${fmtMoney(s.cost)} ₽${minNote}`)
        } else {
          lines.push(`• ${s.title} — ${fmtMoney(s.cost)} ₽`)
        }
      })
    }
    // дополнительные разделы отображаем только в UI (красным), в текст КП не включаем
    lines.push('')
    lines.push('Скачать PDF примеров проектов: https://t.me/galfdesign/1455')
    return lines.join('\n')
  }, [totalAreaM2Rounded, totalPricePerM2, estimatedCostFinal, sectionCosts, disabledSections, proposalDetailed])

  // markdown версия больше не используется

  // Copy formatted table text
  const [copiedCosts, setCopiedCosts] = useState(false)
  const copyCostsToClipboard = async () => {
    try {
      const fmtMoney = (v: number) => new Intl.NumberFormat('ru-RU').format(Number(v.toFixed(2)))
      const lines: string[] = []
      lines.push('Оценка стоимости проектирования')
      lines.push(`Площадь: ${totalAreaM2Rounded} м²`)
      lines.push(`Цена за м²: ${fmtMoney(totalPricePerM2)} ₽/м²`)
      lines.push(`Итого: ${fmtMoney(estimatedCost)} ₽`)
      lines.push('')
      lines.push('Разделы:')
      sectionCosts.forEach(s => {
        lines.push(`- ${s.title}: ${totalAreaM2Rounded} м² × ${fmtMoney(s.price)} ₽/м² = ${fmtMoney(s.cost)} ₽`)
      })
      const text = lines.join('\n')
      await navigator.clipboard.writeText(text)
      setCopiedCosts(true)
      setTimeout(() => setCopiedCosts(false), 1500)
    } catch (e) {
      // ignore
    }
  }

  const [copiedProposal, setCopiedProposal] = useState(false)
  const copyProposalToClipboard = async () => {
    try {
      const tail = disabledSectionLines.length ? `\n\nТакже вы можете заказать проектирование:\n${disabledSectionLines.map(l=>`- ${l}`).join('\n')}` : ''
      const full = `${proposalText}${tail}`
      await navigator.clipboard.writeText(full)
      setCopiedProposal(true)
      setTimeout(() => setCopiedProposal(false), 1500)
    } catch {}
  }
  // markdown-кнопка удалена

  // Manual area input (m²)
  const [manualArea, setManualArea] = useState<string>("")

  // AI analysis state
  const [aiLoading, setAiLoading] = useState(false)
  const [aiResult, setAiResult] = useState<string>("")
  const [aiError, setAiError] = useState<string | null>(null)
  const [aiTestLoading, setAiTestLoading] = useState(false)
  const [aiTestResult, setAiTestResult] = useState<string>("")
  const [aiFiles, setAiFiles] = useState<File[]>([])
  const aiFileInputRef = useRef<HTMLInputElement | null>(null)
  const [aiDragOver, setAiDragOver] = useState(false)
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false)
  const [providerLocal, setProviderLocal] = useState<'openai'|'custom'>(() => {
    try { return (localStorage.getItem('AI_PROVIDER') as 'openai'|'custom') || 'openai' } catch { return 'openai' }
  })
  const [apiUrlLocal, setApiUrlLocal] = useState<string>(() => {
    try { return localStorage.getItem('AI_API_URL') || '' } catch { return '' }
  })
  const [openaiKeyLocal, setOpenaiKeyLocal] = useState<string>(() => {
    try { return localStorage.getItem('OPENAI_API_KEY') || '' } catch { return '' }
  })

  // Helper left in place if потребуется: получение ключа OpenAI из env/localStorage
  // const getOpenAIKey = () => {
  //   const envKey = String(((import.meta as any).env?.VITE_OPENAI_API_KEY) || '').trim()
  //   if (envKey) return envKey
  //   return (openaiKeyLocal || '').trim()
  // }

  // Canvas size responsive
  const [canvasSize] = useState({ w: 1000, h: 650 })
  const [viewerSize] = useState({ w: 900, h: 600 })
  // Parse area from AI response
  const aiParsed = useMemo(() => parseAreasFromAi(aiResult), [aiResult])
  // const aiBestArea = aiParsed.best
  const aiAreasList = useMemo(() => Array.from(new Set(aiParsed.all.map(v => Math.round(v)))).sort((a,b)=>b-a), [aiParsed])
  const [aiSelectedArea, setAiSelectedArea] = useState<number | null>(null)
  useEffect(() => {
    if (aiAreasList.length > 0) setAiSelectedArea(aiAreasList[0])
    else setAiSelectedArea(null)
  }, [aiAreasList])
  useEffect(() => {
    if (viewerOpen) return
    const resize = () => {
      const availableW = window.innerWidth
      setResultWidth(Math.max(240, Math.floor(availableW / 2)))
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [viewerOpen])

  // Render first page of PDF to Image
  const renderPdfPageAsImage = async (pdf: any, pageNumber: number): Promise<HTMLImageElement> => {
    const page = await pdf.getPage(pageNumber)
    const baseViewport = page.getViewport({ scale: 1 })
    const targetMax = 2200
    const scale = Math.min(targetMax / baseViewport.width, targetMax / baseViewport.height, 4)
    const viewport = page.getViewport({ scale: scale > 0 ? scale : 1 })
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    await page.render({ canvasContext: ctx as any, viewport, canvas }).promise
    const blob: Blob = await new Promise((resolve) => canvas.toBlob(b => resolve(b as Blob), 'image/png'))
    const url = URL.createObjectURL(blob)
    const img = new Image()
    await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = reject; img.src = url })
    return img
  }

  // Load image or PDF from file
  const onFile = async (f: File | null) => {
    if (!f) return
    setCurrentFile(f)
    setCurrentFileName(f.name || null)
    const isPdf = (f.type === 'application/pdf') || /\.pdf$/i.test(f.name || '')
    try {
      let img: HTMLImageElement
      if (isPdf) {
        const data = await f.arrayBuffer()
        const pdf = await pdfjsLib.getDocument({ data }).promise
        pdfDocRef.current = pdf
        setPdfPageCount(pdf.numPages)
        setPdfPageNum(1)
        img = await renderPdfPageAsImage(pdf, 1)
      } else {
        pdfDocRef.current = null
        setPdfPageCount(0)
        setPdfPageNum(1)
        const url = URL.createObjectURL(f)
        const image = new Image()
        await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = reject; image.src = url })
        img = image
      }
      setImgEl(img)
      setPoly([])
      setIsClosed(false)
      setScalePts([])
      setRealLen("")
      setViewScale(1)
      setViewOffset({ x: 0, y: 0 })
      setRot(0)
      setViewerOpen(true)
    } catch (err) {
      console.error('Ошибка загрузки файла', err)
    }
  }

  const goToPdfPage = async (page: number) => {
    const pdf = pdfDocRef.current
    if (!pdf) return
    const clamped = Math.max(1, Math.min(pdf.numPages, Math.floor(page)))
    try {
      const img = await renderPdfPageAsImage(pdf, clamped)
      setPdfPageNum(clamped)
      setImgEl(img)
      // reset drawing/calibration for a fresh page
      setPoly([])
      setIsClosed(false)
      setScalePts([])
      setRealLen("")
      setViewScale(1)
      setViewOffset({ x: 0, y: 0 })
    } catch (e) {
      console.error('Не удалось открыть страницу PDF', e)
    }
  }

  // Paste image from clipboard (Ctrl+V) — не срабатывает при фокусе в инпутах
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const active = document.activeElement as HTMLElement | null
      const isTyping = !!active && (
        active.tagName === 'INPUT' ||
        active.tagName === 'TEXTAREA' ||
        (active as any).isContentEditable
      )
      if (isTyping) return
      const items = e.clipboardData?.items
      if (!items) return
      for (let i = 0; i < items.length; i++) {
        const it = items[i]
        if (it.type && it.type.startsWith('image/')) {
          const file = it.getAsFile()
          if (file) {
            e.preventDefault()
            onFile(file)
            break
          }
        }
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [])

  // Prevent page scroll only when viewer is open: block Alt+wheel globally and any wheel over container
  useEffect(() => {
    if (!viewerOpen) return
    const blocker = (ev: WheelEvent) => {
      if (ev.altKey) ev.preventDefault()
    }
    window.addEventListener('wheel', blocker, { passive: false })
    const el = containerRef.current
    const stopScroll = (ev: WheelEvent) => ev.preventDefault()
    el?.addEventListener('wheel', stopScroll, { passive: false })
    return () => {
      window.removeEventListener('wheel', blocker)
      el?.removeEventListener('wheel', stopScroll)
    }
  }, [viewerOpen])

  // Rotate image 90° CW
  const rotate = () => setRot(r => (r + 1) % 4)

  // Reset all
  const resetAll = () => {
    setImgEl(null)
    setCurrentFileName(null)
    setPoly([])
    setIsClosed(false)
    setScalePts([])
    setRealLen("")
    setManualArea("")
    setViewScale(1)
    setViewOffset({ x: 0, y: 0 })
    setRot(0)
  }

  // Compute image dims after rotation
  const imgDims = useMemo(() => {
    if (!imgEl) return { w: 0, h: 0 }
    return rot % 2 === 0 ? { w: imgEl.width, h: imgEl.height } : { w: imgEl.height, h: imgEl.width }
  }, [imgEl, rot])

  // Fit scale to canvas
  const fitScale = useMemo(() => {
    if (!imgEl || !canvasRef.current) return 1
    const { w: cw, h: ch } = canvasSize
    const { w: iw, h: ih } = imgDims
    if (iw === 0 || ih === 0) return 1
    return Math.min(cw / iw, ch / ih)
  }, [imgEl, imgDims, canvasSize])

  // Real meters per pixel from calibration
  const pxDist = useMemo(() => (scalePts.length === 2 ? dist(scalePts[0], scalePts[1]) : 0), [scalePts])
  const mm = useMemo(() => (realLen ? Number(realLen) : 0), [realLen])
  const meters = useMemo(() => (mm > 0 ? mm / 1000 : 0), [mm])
  const metersPerPx = useMemo(() => (pxDist > 0 && meters > 0 ? meters / pxDist : 0), [pxDist, meters])
  const mmPerPx = useMemo(() => (metersPerPx > 0 ? metersPerPx * 1000 : 0), [metersPerPx])

  // Area (px^2 and m^2)
  const areaPx2 = useMemo(() => (poly.length >= 3 ? Math.abs(shoelace(poly)) : 0), [poly])
  const areaM2 = useMemo(() => (metersPerPx > 0 ? areaPx2 * metersPerPx * metersPerPx : 0), [areaPx2, metersPerPx])
  const currentAreaRounded = useMemo(() => {
    const manual = Number(manualArea)
    if (isFinite(manual) && manual > 0) return Math.round(manual)
    if (areaM2 > 0) return Math.round(areaM2)
    return 0
  }, [manualArea, areaM2])

  // Helpers: transform canvas<->image coordinates
  const getBaseTransform = () => {
    const dpr = window.devicePixelRatio || 1
    const cw = canvasSize.w
    const ch = canvasSize.h
    const iw = imgDims.w || 1
    const ih = imgDims.h || 1
    const s = fitScale * viewScale
    const ox = (cw - iw * s) / 2 + viewOffset.x
    const oy = (ch - ih * s) / 2 + viewOffset.y
    return { dpr, s, ox, oy }
  }

  const canvasToImage = (cx: number, cy: number) => {
    const { s, ox, oy } = getBaseTransform()
    return { x: (cx - ox) / s, y: (cy - oy) / s }
  }

  // Mouse handlers
  const [spaceDown, setSpaceDown] = useState(false)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceDown(e.type === 'keydown')
      if (e.key === 'Escape') setViewerOpen(false)
      if (pdfDocRef.current) {
        if (e.key === 'PageDown') { e.preventDefault(); goToPdfPage(pdfPageNum + 1) }
        if (e.key === 'PageUp') { e.preventDefault(); goToPdfPage(pdfPageNum - 1) }
      }
      if (e.key.toLowerCase() === 'z' && (e.ctrlKey || e.metaKey)) {
        setPoly(prev => prev.slice(0, Math.max(0, prev.length - 1)))
      }
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('keyup', onKey)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('keyup', onKey)
    }
  }, [])

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    if (!imgEl) return
    e.preventDefault()
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect()
    const cx = e.clientX - rect.left
    const cy = e.clientY - rect.top

    if (e.altKey) {
      const before = canvasToImage(cx, cy)
      const factor = Math.exp(-e.deltaY * 0.0015)
      const newScale = clamp(viewScale * factor, 0.2, 8)
      setViewScale(newScale)

      setViewOffset(prev => {
        const { s: sNew, ox: oxNew, oy: oyNew } = (() => {
          const iw = imgDims.w || 1
          const ih = imgDims.h || 1
          const s = fitScale * newScale
          const ox = (canvasSize.w - iw * s) / 2 + prev.x
          const oy = (canvasSize.h - ih * s) / 2 + prev.y
          return { s, ox, oy }
        })()
        const afterCanvas = { x: before.x * sNew + oxNew, y: before.y * sNew + oyNew }
        const dx = cx - afterCanvas.x
        const dy = cy - afterCanvas.y
        return { x: prev.x + dx, y: prev.y + dy }
      })
    } else {
      setViewOffset(prev => ({ x: prev.x - e.deltaX, y: prev.y - e.deltaY }))
    }
  }

  const onMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!imgEl) return
    e.preventDefault()
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect()
    const cx = e.clientX - rect.left
    const cy = e.clientY - rect.top

    const isRight = e.button === 2
    const wantPan = isRight || spaceDown

    if (wantPan) {
      setIsPanning(true)
      panStartRef.current = { x: cx, y: cy }
      return
    }

    const pImg = canvasToImage(cx, cy)

    if (mode === 'polygon') {
      const idx = hitTestPoint(poly, pImg, 8 / (fitScale * viewScale))
      if (idx !== -1) {
        setDraggingIdx(idx)
        return
      }
    }

    if (mode === 'scale') {
      setScalePts(prev => (prev.length >= 2 ? [{ x: pImg.x, y: pImg.y }] : [...prev, pImg]))
    } else if (mode === 'polygon' && !isClosed) {
      setPoly(prev => {
        if (prev.length > 0 && e.shiftKey) {
          const last = prev[prev.length - 1]
          const dx = pImg.x - last.x
          const dy = pImg.y - last.y
          if (Math.abs(dx) >= Math.abs(dy)) {
            return [...prev, { x: pImg.x, y: last.y }]
          } else {
            return [...prev, { x: last.x, y: pImg.y }]
          }
        }
        return [...prev, pImg]
      })
    }
  }

  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!imgEl) return
    const rect = (e.target as HTMLCanvasElement).getBoundingClientRect()
    const cx = e.clientX - rect.left
    const cy = e.clientY - rect.top

    if (isPanning && panStartRef.current) {
      const dx = cx - panStartRef.current.x
      const dy = cy - panStartRef.current.y
      panStartRef.current = { x: cx, y: cy }
      setViewOffset(prev => ({ x: prev.x + dx, y: prev.y + dy }))
      return
    }

    if (draggingIdx !== null) {
      const pImg = canvasToImage(cx, cy)
      setPoly(prev => prev.map((p, i) => {
        if (i !== draggingIdx) return p
        if (e.shiftKey && prev.length > 1) {
          const anchorIndex = draggingIdx === 0 ? 1 : draggingIdx - 1
          const anchor = prev[anchorIndex]
          const dx = pImg.x - anchor.x
          const dy = pImg.y - anchor.y
          return Math.abs(dx) >= Math.abs(dy) ? { x: pImg.x, y: anchor.y } : { x: anchor.x, y: pImg.y }
        }
        return pImg
      }))
    }
  }

  const onMouseUp = () => {
    setIsPanning(false)
    setDraggingIdx(null)
  }

  const onDblClick = () => {
    if (mode === 'polygon' && poly.length >= 3) {
      setIsClosed(true)
    }
  }

  const onContextMenu = (e: React.MouseEvent) => e.preventDefault()

  // Draw
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const dpr = window.devicePixelRatio || 1
    canvas.width = Math.floor(canvasSize.w * dpr)
    canvas.height = Math.floor(canvasSize.h * dpr)
    canvas.style.width = `${canvasSize.w}px`
    canvas.style.height = `${canvasSize.h}px`

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, canvasSize.w, canvasSize.h)

    ctx.fillStyle = '#0f172a'
    ctx.fillRect(0, 0, canvasSize.w, canvasSize.h)

    if (!imgEl) {
      drawCenteredText(ctx, 'Загрузите план (JPG/PNG/PDF) или вставьте скриншот (Ctrl+V)', canvasSize.w, canvasSize.h)
      return
    }

    const { s, ox, oy } = getBaseTransform()

    ctx.save()
    ctx.translate(ox, oy)
    ctx.scale(s, s)

    ctx.save()
    const iw = imgDims.w
    const ih = imgDims.h
    ctx.translate(iw / 2, ih / 2)
    ctx.rotate((Math.PI / 2) * rot)
    ctx.translate(-imgEl.width / 2, -imgEl.height / 2)
    ctx.drawImage(imgEl, 0, 0)
    ctx.restore()

    if (scalePts.length > 0) {
      ctx.lineWidth = 2 / s
      ctx.strokeStyle = '#22d3ee'
      ctx.fillStyle = '#22d3ee'
      for (let i = 0; i < scalePts.length - 1; i++) {
        drawSegment(ctx, scalePts[i], scalePts[i + 1])
      }
      scalePts.forEach(p => drawHandle(ctx, p))
      if (scalePts.length === 2) {
        const mid = { x: (scalePts[0].x + scalePts[1].x) / 2, y: (scalePts[0].y + scalePts[1].y) / 2 }
        const px = dist(scalePts[0], scalePts[1]).toFixed(1)
        const mmText = mmPerPx > 0 ? (Number(px) * mmPerPx).toFixed(1) : '—'
        drawLabel(ctx, mid, `${px} px${mmPerPx > 0 ? ` (${mmText} мм)` : ''}`)
      }
    }

    if (poly.length > 0) {
      ctx.lineWidth = 2 / s
      ctx.strokeStyle = '#60a5fa'
      ctx.fillStyle = 'rgba(96,165,250,0.2)'
      if (isClosed && poly.length >= 3) {
        ctx.beginPath()
        ctx.moveTo(poly[0].x, poly[0].y)
        for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y)
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
      } else {
        ctx.beginPath()
        ctx.moveTo(poly[0].x, poly[0].y)
        for (let i = 1; i < poly.length; i++) ctx.lineTo(poly[i].x, poly[i].y)
        ctx.stroke()
      }
      poly.forEach((p, i) => drawHandle(ctx, p, i === 0 ? '#f59e0b' : '#60a5fa'))
    }

    ctx.restore()
  }, [canvasSize, imgEl, imgDims, viewScale, viewOffset, fitScale, poly, isClosed, scalePts, metersPerPx, rot])

  // const canClose = poly.length >= 3 && !isClosed
  // const canUndo = poly.length > 0 && !isClosed

  // Guard against duplicates: pending keys + dedupe in setState
  const pendingKeysRef = useRef<Set<string>>(new Set())

  const createCard = (roundedArea: number) => {
    const now = Date.now()
    const base = currentFileName ?? `План ${results.length + 1}`
    const pageSuffix = pdfDocRef.current && (pdfPageCount || 0) > 1 ? ` (стр. ${pdfPageNum})` : ''
    const name = `${base}${pageSuffix}`
    const key = `${name}|${roundedArea}`
    if (pendingKeysRef.current.has(key)) return
    pendingKeysRef.current.add(key)
    const payload = { id: now, fileName: name, areaM2: roundedArea, scaleMmPerPx: mmPerPx>0?mmPerPx:undefined, savedAt: now }
    setResults(prev => {
      const duplicate = prev.some(r => r.fileName === name && r.areaM2 === roundedArea && (now - r.savedAt) < 2000)
      if (duplicate) {
        pendingKeysRef.current.delete(key)
        return prev
      }
      const updated = [...prev, payload]
      // Release key after commit
      setTimeout(() => pendingKeysRef.current.delete(key), 0)
      return updated
    })
  }

  const addResult = () => {
    // Карточка создаётся только после явного сохранения (ввод площади или расчёт по изображению)
    setUploaderOpen(true)
  }

  const saveFromModal = () => {
    if (currentAreaRounded <= 0) return
    createCard(currentAreaRounded)
    // остаёмся в просмотрщике, чтобы можно было перелистнуть PDF и сохранить ещё
    setPoly([])
    setIsClosed(false)
  }

  const removeResult = (id: number) => {
    setResults(prev => prev.filter(r => r.id !== id))
  }

  const saveManualAreaOnly = () => {
    const rounded = currentAreaRounded
    if (rounded <= 0) return
    createCard(rounded)
    setUploaderOpen(false)
    setManualArea("")
  }

  // === AI Analysis ===
  const analyzeWithAI = async () => {
    setAiError(null)
    const filesToSend = (aiFiles && aiFiles.length > 0) ? aiFiles : (currentFile ? [currentFile] : [])
    if (filesToSend.length === 0) { setAiError('Нет выбранных файлов'); return }
    try {
      setAiLoading(true)
      const provider = ((import.meta as any).env?.VITE_AI_PROVIDER || providerLocal) as 'openai'|'custom'

      if (provider === 'openai') {
        // Build OpenAI responses payload
        const envKey = (import.meta as any).env?.VITE_OPENAI_API_KEY || ''
        const openaiKey = envKey.trim() || (openaiKeyLocal || '').trim()
        if (!openaiKey) throw new Error('Не задан VITE_OPENAI_API_KEY')
        const parts: any[] = [
          { type: 'input_text', text: 'Найди в этом документе упоминания об отапливаемой площади. Ответь кратко по-русски: процитируй формулировки, извлеки числовые значения и единицы (м², кв.м и т.п.), перечисли найденные варианты. Если есть неоднозначности — укажи их. Отдельными строками выведи: "Объект: <текст>" (название объекта), "Адрес: <текст>" (если указан). В конце отдельной строкой выведи: "Достоверность: NN%", где NN — оценка уверенности 0–100.' }
        ]

        for (const fileToSend of filesToSend) {
          const ext = (fileToSend.name || '')
          if (fileToSend.type.startsWith('image/')) {
            const dataUrl = await new Promise<string>((resolve, reject) => { const r = new FileReader(); r.onload = () => resolve(String(r.result)); r.onerror = reject; r.readAsDataURL(fileToSend) })
            parts.push({ type: 'input_image', image_url: dataUrl })
          } else if (fileToSend.type === 'application/pdf' || /\.pdf$/i.test(ext)) {
            const data = await fileToSend.arrayBuffer()
            const pdf = await pdfjsLib.getDocument({ data }).promise
            const pages = Math.min(3, pdf.numPages)
            for (let p = 1; p <= pages; p++) {
              const img = await renderPdfPageAsImage(pdf, p)
              const canvas = document.createElement('canvas')
              canvas.width = img.width; canvas.height = img.height
              const ctx = canvas.getContext('2d')!
              ctx.drawImage(img, 0, 0)
              const dataUrl = canvas.toDataURL('image/png')
              parts.push({ type: 'input_image', image_url: dataUrl })
            }
          } else {
            const text = await fileToSend.text().catch(() => '')
            if (text) parts.push({ type: 'input_text', text: text.slice(0, 4000) })
          }
        }

        const res = await fetch('https://api.openai.com/v1/responses', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: 'gpt-4o-mini', input: [ { role: 'user', content: parts } ], max_output_tokens: 500 })
        })
        if (!res.ok) throw new Error(`OpenAI HTTP ${res.status}`)
        const data = await res.json()
        const text = extractOpenAIText(data)
        setAiResult(String(text || ''))
      } else {
        const apiUrl = (import.meta as any).env?.VITE_AI_API_URL || apiUrlLocal || ''
        const apiKey = (import.meta as any).env?.VITE_AI_API_KEY || ''
        if (!apiUrl) throw new Error('Не задан VITE_AI_API_URL')

        const form = new FormData()
        filesToSend.forEach((f) => {
          form.append('files', f, f.name)
        })
        form.append('task', 'find_heated_area_mentions')
        form.append('lang', 'ru')
        form.append('context', 'Проанализируй тексты документа (включая PDF/изображения после OCR, если это поддерживается) и найди упоминания отапливаемых площадей. Верни краткий ответ на русском языке: укажи найденные формулировки, значения, единицы измерения и, если есть неоднозначности, отметь их. Отдельными строками выведи: "Объект: <текст>" (название объекта), "Адрес: <текст>" (если указан). В конце отдельной строкой выведи: "Достоверность: NN%", где NN — оценка уверенности 0–100.')

        const res = await fetch(apiUrl, {
          method: 'POST',
          headers: apiKey ? { 'Authorization': `Bearer ${apiKey}` } : undefined,
          body: form,
        })
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json().catch(() => null)
        const text = data?.result || data?.text || data?.message || await res.text()
        setAiResult(String(text || 'Пустой ответ'))
      }
    } catch (e: any) {
      setAiError(e?.message || 'Ошибка анализа')
    } finally {
      setAiLoading(false)
    }
  }

  const testAIConnection = async () => {
    setAiError(null)
    setAiTestResult("")
    setAiTestLoading(true)
    try {
      const provider = ((import.meta as any).env?.VITE_AI_PROVIDER || providerLocal) as 'openai'|'custom'
      if (provider === 'openai') {
        const envKey = (import.meta as any).env?.VITE_OPENAI_API_KEY || ''
        const openaiKey = envKey.trim() || (openaiKeyLocal || '').trim()
        if (!openaiKey) { setAiTestResult('OpenAI: не задан VITE_OPENAI_API_KEY'); return }
        const res = await fetch('https://api.openai.com/v1/models', { headers: { 'Authorization': `Bearer ${openaiKey}` } })
        setAiTestResult(`OpenAI: HTTP ${res.status}`)
      } else {
        const apiUrl = (import.meta as any).env?.VITE_AI_API_URL || apiUrlLocal || ''
        if (!apiUrl) { setAiTestResult('Custom: задайте API URL ниже'); return }
        try {
          const head = await fetch(apiUrl, { method: 'HEAD' })
          if (head.ok) { setAiTestResult(`HEAD: HTTP ${head.status}`); return }
        } catch {}
        const url = apiUrl.includes('?') ? `${apiUrl}&ping=1` : `${apiUrl}?ping=1`
        const getRes = await fetch(url, { method: 'GET' })
        setAiTestResult(`GET: HTTP ${getRes.status}${getRes.statusText ? ' ' + getRes.statusText : ''}`)
      }
    } catch (e: any) {
      setAiTestResult(`Ошибка: ${e?.message || 'Unknown'}`)
    } finally {
      setAiTestLoading(false)
    }
  }

  // const resetPoly = () => {
  //   setPoly([])
  //   setIsClosed(false)
  // }
  const resetScale = () => {
    setScalePts([])
    setRealLen("")
  }

  // Reset AI analysis panel
  const resetAI = () => {
    setAiFiles([])
    setAiResult("")
    setAiError(null)
    setAiTestResult("")
    setAiSelectedArea(null)
    setAiDragOver(false)
  }

  useEffect(() => {
    setPoly([])
    setIsClosed(false)
    setScalePts([])
  }, [rot])

  return (
    <>
      <header className="w-full bg-slate-950 border-b border-slate-800 px-3 pt-4 pb-2">
        <div className="mx-auto" style={{ width: `${resultWidth}px` }}>
          <img src={logo} alt="Logo" className="h-8 w-auto" />
        </div>
      </header>
      <div className="flex h-[88vh] w-full gap-4 p-3 text-slate-100 bg-slate-950">
      <div className="w-[320px] flex-shrink-0 space-y-4 hidden">
        <div className="rounded-2xl bg-slate-900 p-4 shadow-xl space-y-3 hidden">
          <h3 className="font-semibold">Файл плана</h3>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => setUploaderOpen(true)} className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700">Открыть окно загрузки</button>
            <button onClick={() => setViewerOpen(true)} disabled={!imgEl} className={`px-3 py-2 rounded-xl ${imgEl? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-800/50 cursor-not-allowed'}`}>Открыть просмотр</button>
            <button onClick={rotate} className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700">Повернуть 90°</button>
            <button onClick={() => { setViewScale(1); setViewOffset({ x: 0, y: 0 }) }} className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700">Fit</button>
            <button onClick={resetAll} className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700">Сбросить все</button>
          </div>
          <div className="text-xs text-slate-400">Также можно вставить скриншот: Ctrl+V</div>
        </div>

        <div className="rounded-2xl bg-slate-900 p-4 shadow-xl space-y-3 hidden">
          <h3 className="font-semibold">Режим</h3>
          <div className="flex gap-2">
            <button onClick={() => setMode('scale')} className={`px-3 py-2 rounded-xl ${mode === 'scale' ? 'bg-cyan-600' : 'bg-slate-800 hover:bg-slate-700'}`}>Калибровка</button>
            <button onClick={() => setMode('polygon')} className={`px-3 py-2 rounded-xl ${mode === 'polygon' ? 'bg-blue-600' : 'bg-slate-800 hover:bg-slate-700'}`}>Контур</button>
          </div>

          <div className="pt-2 space-y-2">
            <div className="text-sm text-slate-300">Калибровочная линия: {scalePts.length}/2 точки{pxDist>0?` — ${pxDist.toFixed(1)} px`:''}</div>
            <div className="flex gap-2 items-center">
              <label className="text-sm text-slate-300">Длина (мм):</label>
              <input
                type="number"
                min="0"
                step="0.001"
                value={realLen}
                onChange={e => setRealLen(e.target.value)}
                className="w-32 px-2 py-1 rounded-lg bg-slate-800 text-slate-100"
                placeholder="например 3500"
              />
              <button onClick={resetScale} className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-sm">Сброс</button>
            </div>
            <div className="text-sm text-slate-300">Масштаб: {mmPerPx>0 ? `${mmPerPx.toFixed(3)} мм/px` : '—'}</div>
          </div>
        </div>

        <div className="rounded-2xl bg-slate-900 p-4 shadow-xl text-xs text-slate-400 hidden">
          Советы точности:
          <ul className="list-disc list-inside space-y-1 mt-2">
            <li>Калибруйте по размерной линии в пределах кадра контура.</li>
            <li>Обводите по наружной грани стен, обходя террасы/козырьки если их не надо учитывать.</li>
            <li>Можно перетягивать вершины мышью (в режиме «Контур»). Удерживайте Shift для осей.</li>
          </ul>
        </div>

        <div className="rounded-2xl bg-slate-900 p-4 shadow-xl space-y-3 hidden">
          <h2 className="text-lg font-semibold">Шаги работы</h2>
          <ol className="list-decimal list-inside text-sm text-slate-300 space-y-1">
            <li>Загрузите или вставьте (Ctrl+V) изображение плана (JPG/PNG).</li>
            <li>Откройте полноэкранный просмотр и выполните калибровку.</li>
            <li>Обведите контур. Двойной клик — замкнуть. Shift — оси.</li>
            <li>Alt + колесо — зум, колесо — панорама. Правая кнопка / Space — панорама.</li>
          </ol>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center">
        {/* убрал встроенный канвас: теперь только в модалке */}
        <div className="w-full flex justify-center gap-3 mt-2 hidden">
          <div
            className="rounded-xl bg-slate-900 border border-slate-700 shadow-xl p-3 text-sm"
            style={{ width: `${resultWidth}px` }}
          >
            <div className="flex items-center justify-between">
              <div className="text-slate-300">Текущий файл: <span className="text-slate-100">{currentFileName ?? '—'}</span></div>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  inputMode="numeric"
                  placeholder="ввести м²"
                  value={manualArea}
                  onChange={(e)=>setManualArea(e.target.value)}
                  className="w-28 px-2 py-1 rounded-lg bg-slate-800 text-slate-100"
                />
                <div className="text-slate-100 font-semibold">{currentAreaRounded>0?currentAreaRounded:'—'} м²</div>
              </div>
            </div>
          </div>
          
          
          <div className="flex items-stretch">
            <button
              onClick={addResult}
              className={`px-4 rounded-xl bg-blue-600 hover:bg-blue-500 text-sm`}
            >Создать карточку</button>
          </div>
        </div>
        <div className="w-full flex flex-col items-center mt-6">
          <div className="grid gap-3" style={{ width: `${resultWidth}px`, gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))' }}>
            {results.length === 0 && null}
            {results.map((r, i) => (
              <div key={r.id} className="rounded-xl bg-slate-900 border border-slate-700 shadow-xl p-3 text-sm flex flex-col justify-between overflow-hidden aspect-square">
                <div className="min-w-0 flex items-start justify-between gap-2">
                  <div className="truncate">
                    <div className="font-semibold truncate" title={r.fileName}>{i+1}. {r.fileName}</div>
                    <div className="text-xs text-slate-400 truncate">{new Date(r.savedAt).toLocaleString()} {r.scaleMmPerPx?`• ${r.scaleMmPerPx.toFixed(3)} мм/px`:''}</div>
                  </div>
                  <button
                    onClick={()=>removeResult(r.id)}
                    aria-label="Удалить"
                    title="Удалить"
                    className="shrink-0 p-1 rounded-md text-slate-400 hover:text-red-400 hover:bg-slate-800/50 transition-colors"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
                <div className="text-right text-slate-100 font-semibold whitespace-nowrap">{Math.round(r.areaM2)} м²</div>
              </div>
            ))}
            <button onClick={addResult} className="aspect-square rounded-xl border-2 border-dashed border-slate-600 hover:border-slate-400 hover:bg-slate-800/30 text-slate-300 flex items-center justify-center text-sm">
              + Новый план
        </button>
            <div className="rounded-xl bg-slate-900 border border-slate-700 shadow-xl p-3 text-sm flex flex-col gap-2" style={{ gridColumn: '1 / -1' }}>
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">Анализ ИИ</h3>
                <div className="flex items-center gap-2">
                  <button onClick={()=>setAiSettingsOpen(true)} className="px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700" title="Настройки">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="3" />
                      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 8 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 3.6 15a1.65 1.65 0 0 0-1.51-1H2a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 3.6 8a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 8 3.6a1.65 1.65 0 0 0 1-1.51V2a2 2 0 1 1 4 0v.09A1.65 1.65 0 0 0 16 3.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 20.4 8c.36.52.57 1.15.57 1.8s-.21 1.28-.57 1.8Z" />
                    </svg>
                  </button>
                  <button onClick={resetAI} className="px-3 py-1 rounded-lg bg-slate-800 hover:bg-slate-700">Сбросить</button>
                  <button onClick={testAIConnection} disabled={aiTestLoading} className={`px-3 py-1 rounded-lg ${!aiTestLoading ? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-800/50 cursor-not-allowed'}`}>{aiTestLoading? 'Проверка…' : 'Проверить связь'}</button>
                  <button onClick={analyzeWithAI} disabled={aiLoading || !((aiFiles && aiFiles.length>0) || currentFile)} className={`px-3 py-1 rounded-lg ${((aiFiles && aiFiles.length>0) || currentFile) && !aiLoading ? 'bg-blue-600 hover:bg-blue-500' : 'bg-slate-800/50 cursor-not-allowed'}`}>{aiLoading? 'Отправка…' : 'Отправить на анализ'}</button>
                </div>
              </div>
              { (aiFiles.length>0 || currentFile) && <div className="text-xs text-slate-400">Файлы: {aiFiles.length>0 ? `${aiFiles.length} выбрано` : (currentFile ? `${currentFile.name} (текущий)` : '—')}</div> }
              <div className="text-xs text-slate-400">Для настроек нажмите на иконку шестерёнки.</div>
              <div
                onDragOver={(e)=>{e.preventDefault(); setAiDragOver(true)}}
                onDragEnter={(e)=>{e.preventDefault(); setAiDragOver(true)}}
                onDragLeave={()=>setAiDragOver(false)}
                onDrop={(e)=>{ e.preventDefault(); setAiDragOver(false); const list = Array.from(e.dataTransfer.files||[]); if (list.length) setAiFiles(prev=>[...prev, ...list]); }}
                className={`rounded-lg border ${aiDragOver? 'border-cyan-400 bg-slate-800/50':'border-slate-700 bg-slate-800/30'} p-2 text-xs text-slate-300`}
              >
                Перетащите файл для анализа сюда
                <div className="mt-1">
                  <button onClick={()=>aiFileInputRef.current?.click()} className="px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-xs">Выбрать файлы</button>
                  <input ref={aiFileInputRef} type="file" multiple className="hidden" onChange={(e)=>{ const list = Array.from(e.target.files||[]); if (list.length) setAiFiles(prev=>[...prev, ...list]) }} />
                </div>
                <div className="mt-1 text-slate-400">{aiFiles.length>0 ? aiFiles.slice(0,3).map(f=>f.name).join(', ') + (aiFiles.length>3?` и ещё ${aiFiles.length-3}`:'') : ''}</div>
              </div>
              {aiTestResult && <div className="text-xs text-slate-400">Связь: {aiTestResult}</div>}
              {aiError && <div className="text-xs text-red-400">{aiError}</div>}
              {aiResult && (
                <div className="mt-1 p-2 rounded-lg bg-slate-800 text-slate-200 whitespace-pre-wrap text-sm">
                  {aiResult}
                  <div className="mt-1 text-xs text-slate-400">{(() => { const m = /Достоверность:\s*(\d{1,3})%/i.exec(aiResult); return m ? `Достоверность анализа: ${Math.min(100, Number(m[1]))}%` : '' })()}</div>
                </div>
              )}
              {aiAreasList.length>0 && (
                <div className="flex items-center gap-2">
                  <div className="text-slate-300 text-sm">Выбрать площадь:</div>
                  <select value={aiSelectedArea ?? ''} onChange={(e)=>setAiSelectedArea(Number(e.target.value)||null)} className="px-2 py-1 rounded-md bg-slate-800 text-slate-100 text-sm">
                    {aiAreasList.map(v=> (
                      <option key={v} value={v}>{v} м²</option>
                    ))}
                  </select>
                  <button onClick={()=>{ if (aiSelectedArea && aiSelectedArea>0) createCard(Math.round(aiSelectedArea)) }} className="px-2 py-1 rounded-md bg-blue-600 hover:bg-blue-500 text-sm">Добавить</button>
                </div>
              )}
            </div>
            <div className="rounded-xl bg-slate-900 border border-slate-700 shadow-xl p-3 text-sm space-y-1" style={{ gridColumn: '1 / -1' }}>
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-semibold">Итоги и стоимость</h3>
                <div className="flex items-center gap-2">
                  <button onClick={copyCostsToClipboard} className="px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200" title="Скопировать в буфер">{copiedCosts ? 'Скопировано' : 'Скопировать'}</button>
                  <button
                  onClick={() => setSettingsOpen(true)}
                  aria-label="Настройки"
                  title="Настройки"
                  className="px-2 py-1 rounded-md bg-red-600 text-white hover:bg-red-500 transition-colors"
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 8 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 3.6 15a1.65 1.65 0 0 0-1.51-1H2a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 3.6 8a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 8 3.6a1.65 1.65 0 0 0 1-1.51V2a2 2 0 1 1 4 0v.09A1.65 1.65 0 0 0 16 3.6a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 20.4 8c.36.52.57 1.15.57 1.8s-.21 1.28-.57 1.8Z" />
                  </svg>
                </button>
                </div>
              </div>
              <div className="flex justify-between"><span className="text-slate-300">Итого</span><span className="text-slate-100 font-semibold">{totalAreaM2Rounded} м²</span></div>
              <div className="flex justify-between"><span className="text-slate-300">Цена за м² (сумма)</span><span className="text-slate-100 font-semibold">{totalPricePerM2.toFixed(2)} ₽/м²</span></div>
              <div className="flex justify-between"><span className="text-slate-300">Общая стоимость</span><span className="text-slate-100 font-semibold">{estimatedCostFinal.toFixed(2)} ₽</span></div>
              <div className="pt-2 text-slate-300">Разделы:</div>
              <table className="w-full mt-1 text-sm">
                <thead>
                  <tr className="text-slate-400">
                    <th className="py-1 pr-2 font-normal text-left">Раздел</th>
                    <th className="py-1 pr-2 font-normal text-right">Площадь, м²</th>
                    <th className="py-1 pr-2 font-normal text-right">Цена за м²</th>
                    <th className="py-1 font-normal text-right">Сумма</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-700">
                  {sectionCosts.map(s => (
                    <tr key={s.key}>
                      <td className="py-1 pr-2 text-slate-300">{s.title}</td>
                      <td className="py-1 pr-2 text-right text-slate-300">{totalAreaM2Rounded}</td>
                      <td className="py-1 pr-2 text-right text-slate-300">{s.price.toFixed(2)} ₽/м²</td>
                      <td className="py-1 text-right text-slate-100">{s.cost.toFixed(2)} ₽</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="rounded-xl bg-slate-900 border border-slate-700 shadow-xl p-3 text-sm space-y-2 mt-6 mb-[100px]" style={{ gridColumn: '1 / -1' }}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold">КП для мессенджера</h3>
              <div className="flex gap-2">
                <button onClick={() => setProposalDetailed(v => !v)} className="px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200" title="Переключить детализацию">{proposalDetailed ? 'Детализация: вкл' : 'Детализация: выкл'}</button>
                <button onClick={copyProposalToClipboard} className="px-2 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200" title="Скопировать текст">{copiedProposal ? 'Скопировано' : 'Скопировать'}</button>
              </div>
            </div>
            <pre className="whitespace-pre-wrap break-words bg-slate-800/40 p-2 rounded-md text-sm">
              <span className="text-slate-200">{proposalText}</span>
              {disabledSectionLines.length>0 && (
                <div className="mt-2 italic text-red-400">
                  Также вы можете заказать проектирование:
                  {disabledSectionLines.map((l, i)=> (
                    <div key={i}>- {l}</div>
                  ))}
                </div>
              )}
            </pre>
          </div>
          
        </div>
      </div>

      {uploaderOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50">
          <div className="mt-16 w-[420px] rounded-2xl bg-slate-900 p-4 shadow-2xl border border-slate-700">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-slate-100">Загрузка плана</h3>
              <button onClick={() => { setUploaderOpen(false); setIsDragOver(false) }} className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200">✕</button>
            </div>
            <div
              onDragOver={(e) => { e.preventDefault(); setIsDragOver(true) }}
              onDragEnter={(e) => { e.preventDefault(); setIsDragOver(true) }}
              onDragLeave={() => setIsDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setIsDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) { onFile(f); setUploaderOpen(false) } }}
              className={`rounded-xl border-2 ${isDragOver ? 'border-cyan-400 bg-slate-800/50' : 'border-slate-700 bg-slate-800/30'} p-6 text-sm text-slate-300 text-center`}
            >
              Перетащите JPG/PNG/PDF сюда
              <div className="mt-2">
                <button onClick={() => fileInputRef.current?.click()} className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700">Выбрать файл</button>
                <input ref={fileInputRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => { onFile(e.target.files?.[0] || null); setUploaderOpen(false) }} />
              </div>
              <div className="mt-2 text-xs text-slate-400">или вставьте Ctrl+V</div>
            </div>
            <div className="mt-4 space-y-2 text-sm">
              <label className="flex items-center justify_between gap-3">
                <span className="text-slate-300">Введите площадь м2, или посчитайте ее из файла</span>
                <input
                  type="number"
                  inputMode="numeric"
                  placeholder="например 120"
                  value={manualArea}
                  onChange={(e)=>setManualArea(e.target.value)}
                  className="w-40 px-2 py-1 rounded-lg bg-slate-800 text-slate-100"
                />
              </label>
              <div className="flex items-center">
                {currentAreaRounded > 0 && (
                  <div className="text-xs text-slate-400 mr-3">Текущая площадь: {currentAreaRounded} м²</div>
                )}
                <button onClick={saveManualAreaOnly} disabled={!(Number(manualArea)>0)} className={`ml-auto px-3 py-1 rounded-lg ${Number(manualArea)>0? 'bg-blue-600 hover:bg-blue-500' : 'bg-slate-800/50 cursor-not-allowed'}`}>Сохранить</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {viewerOpen && (
        <div className="fixed inset-0 z-[60] bg-slate-950/95" onMouseDown={(e)=>{ if (e.target === e.currentTarget) setViewerOpen(false) }}>
          <div className="absolute inset-0 flex items-center justify-center p-6">
            <div ref={containerRef} className="relative bg-slate-900 rounded-2xl border border-slate-700 shadow-2xl" style={{ width: Math.min(window.innerWidth-48, Math.max(600, viewerSize.w)), height: Math.min(window.innerHeight-48, Math.max(420, viewerSize.h)) }} onMouseDown={(e)=>e.stopPropagation()}>
              <canvas
                ref={canvasRef}
                className="absolute inset-0 w-full h-full outline-none select-none rounded-2xl"
                onWheel={onWheel}
                onMouseDown={onMouseDown}
                onMouseMove={onMouseMove}
                onMouseUp={onMouseUp}
                onDoubleClick={onDblClick}
                onContextMenu={onContextMenu}
                tabIndex={0}
              />
              <div className="absolute top-3 left-3 bg-slate-900/80 border border-slate-700 rounded-xl p-3 text-xs space-y-2">
                <div className="flex gap-2">
                  <button onClick={() => setMode('scale')} className={`px-2 py-1 rounded-lg ${mode === 'scale' ? 'bg-cyan-600' : 'bg-slate-800 hover:bg-slate-700'}`}>Калибровка</button>
                  <button onClick={() => setMode('polygon')} className={`px-2 py-1 rounded-lg ${mode === 'polygon' ? 'bg-blue-600' : 'bg-slate-800 hover:bg-slate-700'}`}>Контур</button>
                  <button onClick={saveFromModal} disabled={!(currentAreaRounded>0)} className={`px-2 py-1 rounded-lg ${currentAreaRounded>0? 'bg-blue-600 hover:bg-blue-500' : 'bg-slate-800/50 cursor-not-allowed'}`}>Сохранить</button>
                  <button onClick={() => setViewerOpen(false)} className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700">Закрыть</button>
                </div>
                {pdfDocRef.current && (
                  <div className="flex items-center gap-2">
                    <button onClick={() => goToPdfPage(pdfPageNum - 1)} disabled={pdfPageNum<=1} className={`px-2 py-1 rounded-lg ${pdfPageNum>1? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-800/50 cursor-not-allowed'}`}>←</button>
                    <span className="text-slate-300">Стр.</span>
                    <input type="number" className="w-16 px-2 py-1 rounded-lg bg-slate-800 text-slate-100" value={pdfPageNum} min={1} max={pdfPageCount||1} onChange={(e)=>goToPdfPage(Number(e.target.value))} />
                    <span className="text-slate-400">/ {pdfPageCount || 1}</span>
                    <button onClick={() => goToPdfPage(pdfPageNum + 1)} disabled={pdfPageNum>=(pdfPageCount||1)} className={`px-2 py-1 rounded-lg ${pdfPageNum<(pdfPageCount||1)? 'bg-slate-800 hover:bg-slate-700' : 'bg-slate-800/50 cursor-not-allowed'}`}>→</button>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <span className="text-slate-300">Длина (мм):</span>
                  <input type="number" value={realLen} onChange={e=>setRealLen(e.target.value)} className="w-28 px-2 py-1 rounded-lg bg-slate-800 text-slate-100" />
                  <button onClick={resetScale} className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700">Сброс</button>
                </div>
                <div className="text-slate-300">Масштаб: {mmPerPx>0 ? `${mmPerPx.toFixed(3)} мм/px` : '—'}</div>
                <div className="text-slate-300">Зум: {viewScale.toFixed(2)}×</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {settingsOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50">
          <div className="mt-16 w-[520px] rounded-2xl bg-slate-900 p-4 shadow-2xl border border-slate-700">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-slate-100">Настройки стоимости (за м²)</h3>
              <button onClick={() => setSettingsOpen(false)} className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200">✕</button>
            </div>
            <div className="grid grid-cols-1 gap-3 text-sm">
              <label className="flex items-center justify-between gap-3">
                <span className="text-slate-300">Системы отопления, водоснабжения, котельная (сумма)</span>
                <div className="flex items-center gap-3">
                  <label className="relative inline-flex cursor-pointer items-center">
                    <input type="checkbox" className="sr-only peer" checked={enabled.heatingWaterBoiler} onChange={()=>setEnabled(prev=>({...prev, heatingWaterBoiler: !prev.heatingWaterBoiler}))} />
                    <div className="w-10 h-5 bg-slate-700 rounded-full peer peer-checked:bg-blue-600 transition-colors"></div>
                    <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full peer-checked:translate-x-5 transition-transform"></div>
                  </label>
                  <input type="number" className="w-40 px-2 py-1 rounded-lg bg-slate-800 text-slate-100" value={prices.heatingWaterBoiler} onChange={(e)=>updatePrice('heatingWaterBoiler', e.target.value)} min="0" step="0.01" />
                </div>
              </label>
              <label className="flex items-center justify-between gap-3">
                <span className="text-slate-300">Канализация</span>
                <div className="flex items-center gap-3">
                  <label className="relative inline-flex cursor-pointer items-center">
                    <input type="checkbox" className="sr-only peer" checked={enabled.sewerage} onChange={()=>setEnabled(prev=>({...prev, sewerage: !prev.sewerage}))} />
                    <div className="w-10 h-5 bg-slate-700 rounded-full peer peer-checked:bg-blue-600 transition-colors"></div>
                    <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full peer-checked:translate-x-5 transition-transform"></div>
                  </label>
                  <input type="number" className="w-40 px-2 py-1 rounded-lg bg-slate-800 text-slate-100" value={prices.sewerage} onChange={(e)=>updatePrice('sewerage', e.target.value)} min="0" step="0.01" />
                </div>
              </label>
              <label className="flex items-center justify-between gap-3">
                <span className="text-slate-300">Вентиляция</span>
                <div className="flex items-center gap-3">
                  <label className="relative inline-flex cursor-pointer items-center">
                    <input type="checkbox" className="sr-only peer" checked={enabled.ventilation} onChange={()=>setEnabled(prev=>({...prev, ventilation: !prev.ventilation}))} />
                    <div className="w-10 h-5 bg-slate-700 rounded-full peer peer-checked:bg-blue-600 transition-colors"></div>
                    <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full peer-checked:translate-x-5 transition-transform"></div>
                  </label>
                  <input type="number" className="w-40 px-2 py-1 rounded-lg bg-slate-800 text-slate-100" value={prices.ventilation} onChange={(e)=>updatePrice('ventilation', e.target.value)} min="0" step="0.01" />
                </div>
              </label>
              <label className="flex items-center justify-between gap-3">
                <span className="text-slate-300">Кондиционирование</span>
                <div className="flex items-center gap-3">
                  <label className="relative inline-flex cursor-pointer items-center">
                    <input type="checkbox" className="sr-only peer" checked={enabled.conditioning} onChange={()=>setEnabled(prev=>({...prev, conditioning: !prev.conditioning}))} />
                    <div className="w-10 h-5 bg-slate-700 rounded-full peer peer-checked:bg-blue-600 transition-colors"></div>
                    <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full peer-checked:translate-x-5 transition-transform"></div>
                  </label>
                  <input type="number" className="w-40 px-2 py-1 rounded-lg bg-slate-800 text-slate-100" value={prices.conditioning} onChange={(e)=>updatePrice('conditioning', e.target.value)} min="0" step="0.01" />
                </div>
              </label>
              <label className="flex items-center justify-between gap-3">
                <span className="text-slate-300">Электрические сети</span>
                <div className="flex items-center gap-3">
                  <label className="relative inline-flex cursor-pointer items-center">
                    <input type="checkbox" className="sr-only peer" checked={enabled.electrical} onChange={()=>setEnabled(prev=>({...prev, electrical: !prev.electrical}))} />
                    <div className="w-10 h-5 bg-slate-700 rounded-full peer peer-checked:bg-blue-600 transition-colors"></div>
                    <div className="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full peer-checked:translate-x-5 transition-transform"></div>
                  </label>
                  <input type="number" className="w-40 px-2 py-1 rounded-lg bg-slate-800 text-slate-100" value={prices.electrical} onChange={(e)=>updatePrice('electrical', e.target.value)} min="0" step="0.01" />
                </div>
              </label>
            </div>
            <div className="border-t border-slate-700 pt-3 mt-3 text-sm space-y-1">
              <div className="flex justify-between"><span className="text-slate-300">Итого за м²</span><span className="text-slate-100 font-semibold">{totalPricePerM2.toFixed(2)} ₽/м²</span></div>
              <div className="flex justify-between"><span className="text-slate-300">Общая стоимость</span><span className="text-slate-100 font-semibold">{estimatedCost.toFixed(2)} ₽</span></div>
            </div>
            <div className="mt-3 flex justify-end">
              <button onClick={() => setSettingsOpen(false)} className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500">Готово</button>
            </div>
          </div>
        </div>
      )}

      {aiSettingsOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/50">
          <div className="mt-16 w-[520px] rounded-2xl bg-slate-900 p-4 shadow-2xl border border-slate-700">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-slate-100">Настройки анализа ИИ</h3>
              <button onClick={() => setAiSettingsOpen(false)} className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200">✕</button>
            </div>
            <div className="grid grid-cols-1 gap-3 text-sm">
              <label className="flex items-center justify-between gap-3">
                <span className="text-slate-300">Провайдер</span>
                <select value={providerLocal} onChange={(e)=>{ const v=e.target.value as 'openai'|'custom'; setProviderLocal(v); try{localStorage.setItem('AI_PROVIDER', v)}catch{} }} className="px-2 py-1 rounded-md bg-slate-800 text-slate-100">
                  <option value="openai">OpenAI</option>
                  <option value="custom">Custom API</option>
                </select>
              </label>
              <label className="flex items-center justify-between gap-3">
                <span className="text-slate-300">API URL</span>
                <input value={apiUrlLocal} onChange={(e)=>{ setApiUrlLocal(e.target.value); try{localStorage.setItem('AI_API_URL', e.target.value)}catch{} }} placeholder="https://api.example.com/analyze" className="w-80 px-2 py-1 rounded-md bg-slate-800 text-slate-100" />
              </label>
              <label className="flex items-center justify-between gap-3">
                <span className="text-slate-300">OpenAI ключ</span>
                <input type="password" value={openaiKeyLocal} onChange={(e)=>{ setOpenaiKeyLocal(e.target.value); try{ localStorage.setItem('OPENAI_API_KEY', e.target.value) } catch {} }} placeholder="sk-..." className="w-80 px-2 py-1 rounded-md bg-slate-800 text-slate-100" />
              </label>
            </div>
            <div className="mt-3 flex justify-end">
              <button onClick={() => setAiSettingsOpen(false)} className="px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-500">Готово</button>
            </div>
          </div>
        </div>
      )}
      </div>
    </>
  )

  function extractOpenAIText(data: any): string {
    try {
      if (!data) return ''
      if (typeof data.output_text === 'string') return data.output_text
      const fromOutput = data.output?.[0]?.content?.map?.((p: any) => p?.text || '').join('\n')
      if (fromOutput && fromOutput.trim()) return fromOutput
      const c0 = data.content?.[0]?.text
      if (typeof c0 === 'string') return c0
      const m = data.choices?.[0]?.message?.content
      if (typeof m === 'string') return m
      return typeof data === 'string' ? data : JSON.stringify(data, null, 2)
    } catch { return '' }
  }

  function parseAreasFromAi(text: string): { best: number; all: number[] } {
    const result: number[] = []
    if (!text) return { best: 0, all: [] }
    const normalized = text
      .replace(/\u00A0/g, ' ')
      .replace(/кв\.?\s*м/gi, ' м2')
      .replace(/м\^?2/gi, ' м2')
      .replace(/м²/gi, ' м2')
      .replace(/square\s*meters/gi, ' м2')
    const regex = /(\d[\d\s.,]*?)\s*(?:м2)/gi
    let match: RegExpExecArray | null
    while ((match = regex.exec(normalized)) !== null) {
      let s = match[1].replace(/\s/g, '')
      if (s.includes(',') && s.includes('.')) {
        s = s.replace(/\./g, '').replace(',', '.')
      } else if (s.includes(',') && !s.includes('.')) {
        s = s.replace(',', '.')
      }
      const num = Number(s)
      if (isFinite(num) && num > 0) result.push(num)
    }
    const best = result.length ? Math.max(...result) : 0
    return { best, all: result }
  }

  // === Drawing primitives ===
  function drawSegment(ctx: CanvasRenderingContext2D, a: Pt, b: Pt) {
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.stroke()
  }
  function drawHandle(ctx: CanvasRenderingContext2D, p: Pt, color = '#22d3ee') {
    ctx.save()
    ctx.fillStyle = color
    const r = 4 / (fitScale * viewScale)
    ctx.beginPath()
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }
  function drawLabel(ctx: CanvasRenderingContext2D, p: Pt, text: string) {
    ctx.save()
    ctx.font = `${12 / (fitScale * viewScale)}px ui-sans-serif`
    ctx.fillStyle = '#e2e8f0'
    ctx.strokeStyle = '#0f172a'
    ctx.lineWidth = 3 / (fitScale * viewScale)
    ctx.strokeText(text, p.x + 6 / (fitScale * viewScale), p.y - 6 / (fitScale * viewScale))
    ctx.fillText(text, p.x + 6 / (fitScale * viewScale), p.y - 6 / (fitScale * viewScale))
    ctx.restore()
  }
  function drawCenteredText(ctx: CanvasRenderingContext2D, text: string, w: number, h: number) {
    ctx.save()
    ctx.fillStyle = '#94a3b8'
    ctx.font = '16px ui-sans-serif'
    const metrics = ctx.measureText(text)
    ctx.fillText(text, (w - metrics.width) / 2, h / 2)
    ctx.restore()
  }
}

// === Geometry helpers ===
function dist(a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = a.x - b.x
  const dy = a.y - b.y
  return Math.hypot(dx, dy)
}
function shoelace(pts: { x: number; y: number }[]) {
  let s = 0
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length
    s += pts[i].x * pts[j].y - pts[j].x * pts[i].y
  }
  return s / 2
}
function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v))
}
function hitTestPoint(pts: { x: number; y: number }[], p: { x: number; y: number }, r = 6) {
  for (let i = 0; i < pts.length; i++) if (dist(pts[i], p) <= r) return i
  return -1
}
