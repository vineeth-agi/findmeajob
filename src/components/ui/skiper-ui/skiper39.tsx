"use client"

import { gsap } from "gsap"
import { useEffect, useRef } from "react"

interface CrowdCanvasProps {
  src: string
  rows?: number
  cols?: number
}

const CrowdCanvas = ({ src, rows = 15, cols = 7 }: CrowdCanvasProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const config = {
      src,
      rows,
      cols,
    }

    // UTILS
    const randomRange = (min: number, max: number) =>
      min + Math.random() * (max - min)
    const randomIndex = (array: any[]) => randomRange(0, array.length) | 0
    const removeFromArray = (array: any[], i: number) => array.splice(i, 1)[0]
    const removeItemFromArray = (array: any[], item: any) =>
      removeFromArray(array, array.indexOf(item))
    const removeRandomFromArray = (array: any[]) =>
      removeFromArray(array, randomIndex(array))
    const getRandomFromArray = (array: any[]) => array[randomIndex(array) | 0]

    // TWEEN FACTORIES
    const resetPeep = ({ stage, peep }: { stage: any; peep: any }) => {
      const direction = Math.random() > 0.5 ? 1 : -1
      const spriteScale = peep.height / 324
      const offsetY =
        (100 - 250 * gsap.parseEase("power2.in")(Math.random())) * spriteScale
      // Keep each locally-rendered illustration fully inside the footer frame.
      // The previous offset could place a sprite's head above the canvas on
      // narrow screens, which made the mobile crowd look clipped.
      const startY = Math.max(0, stage.height - peep.height + offsetY)
      let startX: number
      let endX: number

      if (direction === 1) {
        startX = -peep.width
        endX = stage.width
        peep.scaleX = 1
      } else {
        startX = stage.width + peep.width
        endX = 0
        peep.scaleX = -1
      }

      peep.x = startX
      peep.y = startY
      peep.anchorY = startY

      return {
        startX,
        startY,
        endX,
      }
    }

    const normalWalk = ({ peep, props }: { peep: any; props: any }) => {
      const { startY, endX } = props
      const xDuration = 10
      const yDuration = 0.25

      const tl = gsap.timeline()
      tl.timeScale(randomRange(0.5, 1.5))
      tl.to(
        peep,
        {
          duration: xDuration,
          x: endX,
          ease: "none",
        },
        0
      )
      tl.to(
        peep,
        {
          duration: yDuration,
          repeat: xDuration / yDuration,
          yoyo: true,
          y: startY - Math.max(3, 10 * (peep.height / 324)),
        },
        0
      )

      return tl
    }

    const walks = [normalWalk]

    // TYPES
    type Peep = {
      image: HTMLImageElement
      rect: number[]
      sourceWidth: number
      sourceHeight: number
      width: number
      height: number
      drawArgs: any[]
      x: number
      y: number
      anchorY: number
      scaleX: number
      walk: any
      setRect: (rect: number[]) => void
      setScale: (scale: number) => void
      render: (ctx: CanvasRenderingContext2D) => void
    }

    // FACTORY FUNCTIONS
    const createPeep = ({
      image,
      rect,
    }: {
      image: HTMLImageElement
      rect: number[]
    }): Peep => {
      const peep: Peep = {
        image,
        rect: [],
        sourceWidth: 0,
        sourceHeight: 0,
        width: 0,
        height: 0,
        drawArgs: [],
        x: 0,
        y: 0,
        anchorY: 0,
        scaleX: 1,
        walk: null,
        setRect: (nextRect: number[]) => {
          peep.rect = nextRect
          peep.sourceWidth = nextRect[2]
          peep.sourceHeight = nextRect[3]
          peep.width = peep.sourceWidth
          peep.height = peep.sourceHeight
          peep.drawArgs = [
            peep.image,
            ...nextRect,
            0,
            0,
            peep.width,
            peep.height,
          ]
        },
        setScale: (scale: number) => {
          peep.width = peep.sourceWidth * scale
          peep.height = peep.sourceHeight * scale
        },
        render: (renderContext: CanvasRenderingContext2D) => {
          renderContext.save()
          renderContext.translate(peep.x, peep.y)
          renderContext.scale(peep.scaleX, 1)
          renderContext.drawImage(
            peep.image,
            peep.rect[0],
            peep.rect[1],
            peep.rect[2],
            peep.rect[3],
            0,
            0,
            peep.width,
            peep.height
          )
          renderContext.restore()
        },
      }

      peep.setRect(rect)
      return peep
    }

    // MAIN
    const img = document.createElement("img")
    const stage = {
      width: 0,
      height: 0,
      pixelRatio: 1,
      spriteScale: 1,
    }

    const allPeeps: Peep[] = []
    const availablePeeps: Peep[] = []
    const crowd: Peep[] = []
    let initialized = false
    let cancelled = false
    let resizeFrame: number | null = null

    const createPeeps = () => {
      if (allPeeps.length > 0) return
      const { rows: spriteRows, cols: spriteColumns } = config
      const { naturalWidth: width, naturalHeight: height } = img
      if (!width || !height) return
      const total = spriteRows * spriteColumns
      const rectWidth = width / spriteRows
      const rectHeight = height / spriteColumns

      for (let i = 0; i < total; i++) {
        allPeeps.push(
          createPeep({
            image: img,
            rect: [
              (i % spriteRows) * rectWidth,
              ((i / spriteRows) | 0) * rectHeight,
              rectWidth,
              rectHeight,
            ],
          })
        )
      }
    }

    const initCrowd = () => {
      while (availablePeeps.length) {
        addPeepToCrowd().walk.progress(Math.random())
      }
    }

    const addPeepToCrowd = () => {
      const peep = removeRandomFromArray(availablePeeps)
      const walk = getRandomFromArray(walks)({
        peep,
        props: resetPeep({
          peep,
          stage,
        }),
      }).eventCallback("onComplete", () => {
        removePeepFromCrowd(peep)
        addPeepToCrowd()
      })

      peep.walk = walk

      crowd.push(peep)
      crowd.sort((a, b) => a.anchorY - b.anchorY)

      return peep
    }

    const removePeepFromCrowd = (peep: Peep) => {
      removeItemFromArray(crowd, peep)
      availablePeeps.push(peep)
    }

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)
      ctx.save()
      ctx.scale(stage.pixelRatio, stage.pixelRatio)

      crowd.forEach((peep) => {
        peep.render(ctx)
      })

      ctx.restore()
    }

    const resize = () => {
      stage.width = canvas.clientWidth
      stage.height = canvas.clientHeight
      if (!stage.width || !stage.height) return

      stage.pixelRatio = Math.max(1, window.devicePixelRatio || 1)
      stage.spriteScale = Math.max(
        0.48,
        Math.min(1, stage.width / 1440, stage.height / 600)
      )
      canvas.width = Math.round(stage.width * stage.pixelRatio)
      canvas.height = Math.round(stage.height * stage.pixelRatio)

      allPeeps.forEach((peep) => {
        peep.setScale(stage.spriteScale)
      })

      crowd.forEach((peep) => {
        peep.walk?.kill()
      })

      crowd.length = 0
      availablePeeps.length = 0
      availablePeeps.push(...allPeeps)

      initCrowd()
    }

    const init = () => {
      if (cancelled || initialized) return
      createPeeps()
      resize()
      gsap.ticker.add(render)
      initialized = true
    }

    img.onload = init
    img.src = config.src
    if (img.complete && img.naturalWidth > 0) {
      init()
    }

    const handleResize = () => {
      if (!initialized || resizeFrame !== null) return
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = null
        resize()
      })
    }
    const resizeObserver = new ResizeObserver(handleResize)
    resizeObserver.observe(canvas)
    window.addEventListener("resize", handleResize)

    return () => {
      cancelled = true
      img.onload = null
      resizeObserver.disconnect()
      window.removeEventListener("resize", handleResize)
      if (resizeFrame !== null) {
        window.cancelAnimationFrame(resizeFrame)
      }
      gsap.ticker.remove(render)
      crowd.forEach((peep) => {
        if (peep.walk) peep.walk.kill()
      })
    }
  }, [cols, rows, src])
  return (
    <canvas
      ref={canvasRef}
      style={{ position: 'absolute', inset: '0', width: '100%', height: '100%' }}
    />
  )
}

const Skiper39 = () => {
  return (
    <div style={{ position: 'relative', width: '100vw', marginLeft: 'calc(50% - 50vw)', height: 'min(50svh, 24rem)', overflow: 'hidden', background: 'var(--gray-100)' }}>
      {/* Giant Text SVG matching OpenLogo style */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          display: 'flex',
          justifyContent: 'center',
          pointerEvents: 'none',
          WebkitMaskImage: 'linear-gradient(to bottom, black 50%, transparent 100%)',
          maskImage: 'linear-gradient(to bottom, black 50%, transparent 100%)',
          zIndex: 0,
        }}
      >
        <svg
          style={{ width: '100%', height: 'auto', userSelect: 'none' }}
          viewBox="0 0 900 120"
          preserveAspectRatio="xMidYMid meet"
          aria-label="Findmeajob"
        >
          <defs>
            <linearGradient id="watermark-gradient" x1="0%" y1="0%" x2="0%" y2="100%">
              <stop offset="0%" stopColor="#333333" />
              <stop offset="25%" stopColor="#2A2A2A" />
              <stop offset="50%" stopColor="#1A1A1A" />
              <stop offset="75%" stopColor="#101010" />
              <stop offset="100%" stopColor="#0A0A0A" />
            </linearGradient>
          </defs>
          <text
            x="0"
            y="110"
            dominantBaseline="alphabetic"
            textAnchor="start"
            textLength="100%"
            lengthAdjust="spacing"
            fill="url(#watermark-gradient)"
            style={{ fontWeight: 700, letterSpacing: '-0.05em', fontFamily: 'Maison, sans-serif' }}
            fontSize="140"
          >
            Findmeajob
          </text>
        </svg>
      </div>

      <div style={{ position: 'absolute', inset: '0', width: '100%', height: '100%', zIndex: 1 }}>
        <CrowdCanvas src="/images/peeps/all-peeps.png" rows={15} cols={7} />
      </div>
    </div>
  )
}

export { CrowdCanvas, Skiper39 }
