/**
 * Browser half of `dsh-stock-ticker`.
 *
 * Hand-authored in the loader's factory form on purpose: this package ships no
 * build step, so `lib/client.js` IS the artifact the `modules` row serves at
 * `/plugins/dsh-stock-ticker/client.js`. The shape is exactly what the shared
 * tsdown client preset emits for a TypeScript plugin — a
 * `window.__ModuleLoader__.load({ id, factory })` call whose factory resolves
 * platform singletons (`react`, `@deepseek-ai/dsh-client-ui-primitives`, …)
 * through the injected `require`. Everything the factory itself needs is
 * therefore resolved INSIDE the factory, never at module scope.
 *
 * Two seats are contributed:
 *
 * - `shell.overlay` → the mini-window: a draggable, collapsible panel that
 *   shows one row per watched instrument. Rows inside `maxCurves` draw an
 *   intraday curve; hovering a row opens its full detail card without
 *   disturbing the layout of its neighbours.
 * - `settings.section` → the "Stocks" settings page: watchlist add/remove/
 *   reorder plus the curve-count, refresh cadence, and visibility controls.
 *   It persists through the host-registered `stock-ticker` settings namespace,
 *   so the mini-window and the page are two views of one durable section.
 */
window.__ModuleLoader__.load({
  id: 'dsh-stock-ticker',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports

    const React = require('react')

    // The primitives package is a platform seed the shell shares, and its
    // surface moves between releases (the 0.2 line dropped the `…16` size
    // suffixes from icon names, for instance). Everything this bundle takes
    // from it is therefore resolved opportunistically: a renamed or absent
    // export must degrade to a plain element or an inline glyph, never abort
    // the whole bundle at require time.
    const primitives = require('@deepseek-ai/dsh-client-ui-primitives') ?? {}

    /**
     * Build one 16px outline glyph, matching the primitives' own icon
     * contract (`fill="currentColor"`-driven or stroked with `currentColor`,
     * so colour follows the surrounding text).
     *
     * @param children - SVG child elements forming the glyph.
     * @param stroked - true to stroke the path with `currentColor` instead of filling it.
     * @returns a React component taking `{ size?, className? }`.
     */
    const glyph = (children, stroked = false) => function Glyph(props) {
      const size = props?.size ?? 16
      return React.createElement('svg', {
        className: props?.className,
        width: size,
        height: size,
        viewBox: '0 0 16 16',
        fill: 'none',
        'aria-hidden': 'true',
        focusable: 'false',
      }, React.createElement('g', {
        fill: stroked ? 'none' : 'currentColor',
        stroke: stroked ? 'currentColor' : 'none',
        strokeWidth: stroked ? 1.4 : undefined,
        strokeLinecap: stroked ? 'round' : undefined,
        strokeLinejoin: stroked ? 'round' : undefined,
        // A glyph is built from a positional child list, so the index is the
        // only stable identity available for React's reconciliation.
      }, React.Children.map(children, (child, index) =>
        React.isValidElement(child) ? React.cloneElement(child, { key: String(index) }) : child)))
    }
    const polyline = (points) => React.createElement('polyline', { points })
    const line = (x1, y1, x2, y2) => React.createElement('line', { x1, y1, x2, y2 })
    const path = (d) => React.createElement('path', { d })

    /**
     * Chevron: one glyph rendered in both directions by rotating it, so the
     * pair cannot drift apart.
     */
    const chevronGlyph = glyph([polyline('3.5,6 8,10.5 12.5,6')], true)
    const IconChevronDown = (props) => chevronGlyph(props)
    const IconChevronUp = (props) => React.createElement('span', {
      style: { display: 'inline-flex', transform: 'rotate(180deg)' },
    }, chevronGlyph(props))
    /** Close: a plain cross. */
    const IconClose = glyph([line(4, 4, 12, 12), line(12, 4, 4, 12)], true)
    /** Plus: a cross with equal arms. */
    const IconPlus = glyph([line(8, 3.2, 8, 12.8), line(3.2, 8, 12.8, 8)], true)
    /** Trash: a lidded bin. */
    const IconTrash = glyph([
      path('M3.2 4.6h9.6'),
      path('M6.4 4.6V3.4a1 1 0 0 1 1-1h1.2a1 1 0 0 1 1 1v1.2'),
      path('M4.6 4.6l.6 8a1 1 0 0 0 1 .9h3.6a1 1 0 0 0 1-.9l.6-8'),
      path('M6.8 7.4v4'),
      path('M9.2 7.4v4'),
    ], true)
    /**
     * Pin: a thumbtack — a wide cap, a narrow neck, square shoulders, and the
     * point that actually holds the panel. Not a location marker: this control
     * fixes the window where it is, it does not "go to" a spot.
     *
     * The same silhouette carries both states, filled in both cases: at this
     * size an outlined tack loses the head-to-shank contrast that makes it
     * readable at all. Holding is said by weight and colour instead — a filled
     * tack in a muted tone when the window is free, and the same tack in the
     * button's active colour when it is pinned (see `.stock-ticker-icon-button`
     * and its `-active` modifier).
     */
    const TACK = 'M8 1.5c-1.9 0-3.4.8-3.4 1.8 0 .7 1 1.3 2.4 1.6v2.4H6.2v3.1l1.8 2.4 1.8-2.4V7.3H8.999V4.9c1.4-.3 2.4-.9 2.4-1.6 0-1-1.5-1.8-3.4-1.8Z'
    const IconPin = glyph([path(TACK)])

    /** Search: a magnifier. */
    const IconSearch = glyph([
      React.createElement('circle', { cx: 7, cy: 7, r: 4.1 }),
      line(10.1, 10.1, 13.4, 13.4),
    ], true)
    /**
     * Refresh: a circular arrow. Two 110-degree arcs plus an arrowhead read as
     * a "reload" at 16px without needing the primitives' own glyph.
     */
    const IconRefresh = glyph([
      path('M3 8a5 5 0 1 1 1.6 3.7'),
      polyline('3.4,4.6 3.2,7.4 6,7.1'),
    ], true)

    /**
     * Button: the primitives' real component when present, a native button
     * otherwise. Both forms spread the caller's props, so `onClick`,
     * `disabled`, and `title` behave identically.
     */
    const Button = primitives.Button ?? function FallbackButton(props) {
      const { variant, size, icon, className, children, ...rest } = props
      void variant
      void size
      return React.createElement('button', {
        type: 'button',
        className,
        ...rest,
      }, icon ?? null, children)
    }

    /**
     * Input: the primitives' real component when present (it wraps the native
     * input in an icon span), a bare input otherwise.
     */
    const Input = primitives.Input ?? function FallbackInput(props) {
      const { icon, className, ...rest } = props
      // Mirrors the primitives' own wrapper so layout and the icon decoration
      // behave the same when the real component is absent.
      return React.createElement('span', { className: className === undefined ? 'dsh-input' : `dsh-input ${className}` },
        icon === undefined ? null : React.createElement('span', { className: 'dsh-input-icon' }, icon),
        React.createElement('input', rest))
    }

    /** Copy namespace for `ctx.locale`; declared through the locale registration. */
    const LOCALE_NS = 'stock-ticker'

    /** Route prefix owned by the host half. */
    const API = '/api/stock-ticker'

    /**
     * Client build stamp.
     *
     * The profile's client bundle is served from disk and only re-read when the
     * page reloads, so a running page can outlive the code on disk by a long
     * way. Showing the stamp on the settings page turns "the fix is not
     * working" into "the page is running an older build", which is otherwise a
     * guess. Bump it whenever client behaviour changes.
     */
    const CLIENT_BUILD = '2026-09-30.6'

    /**
     * Market palette, in one place so the direction-to-hue mapping is a single
     * readable decision rather than scattered colour literals.
     *
     * Chinese equity convention: a rising price is RED and a falling price is
     * GREEN — the opposite of the Western convention the platform's own
     * `state-success` / `state-error` aliases encode. Referencing the aliases by
     * role rather than by their semantic names is what keeps this honest, and
     * flipping a market means editing this table only.
     */
    const TICKER_PALETTE = {
      up: 'var(--dsw-alias-state-error-primary)',
      down: 'var(--dsw-alias-state-success-primary)',
      flat: 'var(--dsw-alias-label-tertiary)',
    }

    /**
     * Resolve one direction's colour token.
     *
     * @param direction - `up`, `down`, or `flat`.
     * @returns the CSS colour expression for that direction.
     */
    const tickerColor = (direction) => TICKER_PALETTE[direction] ?? TICKER_PALETTE.flat

    /** Per-exchange closing minutes, used to stop polling an idle market. */
    const REFRESH_OPTIONS = [
      { id: '5000', zh: '5 秒', en: '5s' },
      { id: '15000', zh: '15 秒', en: '15s' },
      { id: '30000', zh: '30 秒', en: '30s' },
      { id: '60000', zh: '1 分钟', en: '1m' },
    ]

    /** Watchlist cap mirrored from the host schema. */
    const MAX_WATCHLIST = 24

    /** Curves drawn per refresh; the host budget is one request per curve. */
    const CURVE_LIMIT = 24

    /**
     * Dictionaries. `zh` is the key-set source of truth; `en` must stay
     * complete, because the locale registry refuses a lopsided registration.
     */
    const zh = {
      nav: '股票盯盘',
      title: '实时盯盘',
      empty: '尚未添加个股，请到「设置 → 股票盯盘」添加。',
      loading: '加载中…',
      error: '行情获取失败',
      stale: '行情源限流 · 显示最后数据',
      retry: '重试',
      collapse: '收起',
      expand: '展开',
      hide: '隐藏小窗口',
      refresh: '立即刷新',
      updated: '更新于',
      closed: '休市',
      openSession: '交易中',
      open: '开盘',
      high: '最高',
      low: '最低',
      prevClose: '昨收',
      volume: '成交量',
      turnover: '成交额',
      turnoverRate: '换手率',
      amplitude: '振幅',
      volumeRatio: '量比',
      marketCap: '总市值',
      floatCap: '流通市值',
      pePb: '市盈/市净',
      limitUp: '涨停',
      limitDown: '跌停',
      settingsTitle: '股票盯盘',
      settingsIntro: '配置小窗口展示的个股与分时曲线数量。列表顺序即为小窗口中的显示顺序。',
      countTitle: '展示分时曲线的个股数量',
      countDesc: `超出该数量的个股只显示最新价与涨跌幅，鼠标悬浮仍可查看详情（1 - ${String(MAX_WATCHLIST)}）。`,
      refreshTitle: '刷新间隔',
      refreshDesc: '交易时段内按此间隔轮询行情；休市后自动降频。',
      visibleTitle: '显示盯盘小窗口',
      visibleDesc: '关闭后可从设置页重新开启。',
      opacityTitle: '窗口透明度',
      opacityDesc: '数值越小越透明（35% - 100%）。',
      pinnedTitle: '钉住位置',
      pinnedDesc: '拖动标题栏即可把窗口钉在任意位置；钉住后刷新页面仍会停在原处。',
      pin: '钉住',
      unpin: '取消钉住',
      resetPosition: '回到默认位置',
      pinned: '已钉住',
      floating: '未钉住',
      dragHint: '拖动可移动',
      watchlistTitle: '自选股',
      searchPlaceholder: '输入代码或名称，如 600519 / 茅台',
      searchEmpty: '没有匹配的个股',
      add: '添加',
      remove: '删除',
      moveUp: '上移',
      moveDown: '下移',
      already: '已在列表中',
      saving: '保存中…',
      saved: '已保存',
      clientBuild: '前端',
      hostBuild: '宿主',
      loadFailed: '设置读取失败',
      totalCount: '共 {{count}} 只',
    }

    const en = {
      nav: 'Stocks',
      title: 'Live Quotes',
      empty: 'No instruments yet — add some in Settings → Stocks.',
      loading: 'Loading…',
      error: 'Quote request failed',
      stale: 'Feed throttled · showing last data',
      retry: 'Retry',
      collapse: 'Collapse',
      expand: 'Expand',
      hide: 'Hide mini-window',
      refresh: 'Refresh now',
      updated: 'Updated',
      closed: 'Closed',
      openSession: 'Open',
      open: 'Open',
      high: 'High',
      low: 'Low',
      prevClose: 'Prev close',
      volume: 'Volume',
      turnover: 'Turnover',
      turnoverRate: 'Turnover rate',
      amplitude: 'Amplitude',
      volumeRatio: 'Volume ratio',
      marketCap: 'Market cap',
      floatCap: 'Float cap',
      pePb: 'P/E · P/B',
      limitUp: 'Limit up',
      limitDown: 'Limit down',
      settingsTitle: 'Stock ticker',
      settingsIntro: 'Configure which instruments the mini-window shows and how many get an intraday curve. List order is display order.',
      countTitle: 'Instruments with an intraday curve',
      countDesc: `Instruments beyond this count show price and change only; hovering still reveals the full detail card (1 - ${String(MAX_WATCHLIST)}).`,
      refreshTitle: 'Refresh interval',
      refreshDesc: 'Polling cadence during trading hours; it slows down automatically once the market closes.',
      visibleTitle: 'Show the mini-window',
      visibleDesc: 'Turn it back on from this settings page at any time.',
      opacityTitle: 'Window opacity',
      opacityDesc: 'Lower is more transparent (35% - 100%).',
      pinnedTitle: 'Pin position',
      pinnedDesc: 'Drag the title bar to place the window anywhere; a pinned window returns to the same spot after a reload.',
      pin: 'Pin',
      unpin: 'Unpin',
      resetPosition: 'Reset to the default corner',
      pinned: 'Pinned',
      floating: 'Floating',
      dragHint: 'Drag to move',
      watchlistTitle: 'Watchlist',
      searchPlaceholder: 'Code or name, e.g. 600519 / Moutai',
      searchEmpty: 'No matching instrument',
      add: 'Add',
      remove: 'Remove',
      moveUp: 'Move up',
      moveDown: 'Move down',
      already: 'Already in the list',
      saving: 'Saving…',
      saved: 'Saved',
      clientBuild: 'Client',
      hostBuild: 'host',
      loadFailed: 'Failed to read settings',
      totalCount: '{{count}} instruments',
    }

    /**
     * The dictionary for one locale id, falling back to the shipped Chinese set.
     *
     * @param localeId - active locale id reported by the locale service.
     * @returns the key-to-copy table for that locale.
     */
    const dictionaryFor = (localeId) => (String(localeId).toLowerCase().startsWith('en') ? en : zh)

    /**
     * Resolve one copy key, deterministically.
     *
     * The framework's translator is consulted first so a deployment that
     * overrides this namespace wins, but a miss must not leak a raw key into the
     * UI: the lookup falls back to the dictionary this bundle owns. The check is
     * "is the result a real string that differs from the key" rather than "is it
     * not the key", because a strict translator may return `undefined` or a
     * namespaced miss marker instead.
     *
     * @param t - framework-provided translate function, when one is available.
     * @param localeId - active locale id, used to pick the fallback dictionary.
     * @param key - dictionary key.
     * @param values - optional `{{name}}` interpolation values.
     * @returns the localized string (never the bare key when a table has it).
     */
    const tx = (t, localeId, key, values) => {
      if (t !== undefined) {
        const found = t(key, values)
        if (typeof found === 'string' && found !== '' && found !== key) return found
      }
      const table = dictionaryFor(localeId)
      return table[key] ?? zh[key] ?? key
    }

    /**
     * Interpolate `{{name}}` placeholders.
     *
     * @param text - template string.
     * @param values - replacement map.
     * @returns the rendered string.
     */
    const fill = (text, values) => {
      if (values === undefined) return text
      return text.replace(/\{\{(\w+)\}\}/g, (_, name) => String(values[name] ?? ''))
    }

    /**
     * Build the copy lookup a component uses.
     *
     * @param t - framework translate function, or undefined when the seat is absent.
     * @param localeId - active locale id.
     * @returns a `(key, values?) => string` lookup bound to that locale.
     */
    const createText = (t, localeId) => (key, values) => fill(tx(t, localeId, key, values), values)

    /** Format a signed number for display. */
    const signed = (value, digits = 2) => {
      if (typeof value !== 'number' || !Number.isFinite(value)) return '--'
      return `${value > 0 ? '+' : ''}${value.toFixed(digits)}`
    }

    /** Format a price to two decimals, tolerating a missing value. */
    const priceText = (value) =>
      typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '--'

    /** Whether the Chinese A-share session is plausibly open, in Beijing time. */
    const isTradingNow = () => {
      const beijing = new Date(Date.now() + 8 * 3_600_000)
      const day = beijing.getUTCDay()
      if (day === 0 || day === 6) return false
      const minutes = beijing.getUTCHours() * 60 + beijing.getUTCMinutes()
      return (minutes >= 9 * 60 + 15 && minutes <= 11 * 60 + 30)
        || (minutes >= 12 * 60 + 55 && minutes <= 15 * 60 + 5)
    }

    /** Format an epoch millisecond value as a wall clock time. */
    const clockText = (epochMs) => {
      const date = new Date(epochMs)
      return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`
    }

    /**
     * POST one JSON route on the host half.
     *
     * @param route - route suffix under {@link API}.
     * @param body - JSON request body.
     * @param signal - cancellation signal.
     * @returns the parsed response body.
     * @throws {Error} when the response is not 2xx or not JSON.
     */
    const postJson = async (route, body, signal) => {
      const response = await fetch(`${API}${route}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body ?? {}),
        signal,
      })
      if (!response.ok) throw new Error(`${route} -> HTTP ${String(response.status)}`)
      return await response.json()
    }

    /**
     * Intraday sparkline for one instrument.
     *
     * The domain is priced, not normalized: the baseline is the previous close
     * and both series share the y-range, so a flat line and a 3% move cannot
     * look alike. `vector-effect` keeps stroke weight constant under the
     * non-uniform viewBox scale.
     */
    const Sparkline = (props) => {
      const { points: rawPoints, previousClose, width = 108, height = 22, color } = props
      // A full session is 241 one-minute samples drawn into ~108px, under half
      // a pixel per sample: rendered literally the line is a solid smear of
      // aliasing rather than a shape. A centred three-point mean removes the
      // sub-pixel jitter while leaving every real move visible.
      const points = rawPoints.map((point, index) => {
        const before = rawPoints[index - 1] ?? point
        const after = rawPoints[index + 1] ?? point
        return {
          ...point,
          price: (before.price + point.price + after.price) / 3,
          average: typeof point.average === 'number'
            ? ((before.average ?? before.price) + point.average + (after.average ?? after.price)) / 3
            : point.average,
        }
      })
      const pad = 1.5
      const highs = []
      const lows = []
      for (const point of points) {
        highs.push(point.price)
        if (typeof point.average === 'number') highs.push(point.average)
        lows.push(point.price)
        if (typeof point.average === 'number') lows.push(point.average)
      }
      if (typeof previousClose === 'number' && Number.isFinite(previousClose)) {
        highs.push(previousClose)
        lows.push(previousClose)
      }
      let max = Math.max(...highs)
      let min = Math.min(...lows)
      if (!Number.isFinite(max) || !Number.isFinite(min)) { max = 1; min = 0 }
      if (max - min < 1e-9) { max += 0.01; min -= 0.01 }
      const x = (index) => (points.length <= 1 ? 0 : (index / (points.length - 1)) * width)
      const y = (value) => pad + (1 - (value - min) / (max - min)) * (height - pad * 2)
      if (points.length === 0) return null
      const line = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(2)},${y(point.price).toFixed(2)}`).join(' ')
      const area = `${line} L${width.toFixed(2)},${String(height)} L0,${String(height)} Z`
      const average = points.every(point => typeof point.average === 'number')
        ? points.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(2)},${y(point.average).toFixed(2)}`).join(' ')
        : undefined
      const baseline = typeof previousClose === 'number' && Number.isFinite(previousClose) ? y(previousClose) : undefined
      const gradientId = `stock-ticker-fill-${String(props.id ?? 'x')}`
      return React.createElement('svg', {
        className: 'stock-ticker-spark',
        viewBox: `0 0 ${String(width)} ${String(height)}`,
        width,
        height,
        preserveAspectRatio: 'none',
        // The viewBox is 1:1 with the box, so precision (not speed) is the
        // right trade for a chart whose whole job is a readable slope.
        shapeRendering: 'geometricPrecision',
        'aria-hidden': 'true',
      },
        React.createElement('defs', null,
          React.createElement('linearGradient', { id: gradientId, x1: '0', y1: '0', x2: '0', y2: '1' },
            React.createElement('stop', { offset: '0%', stopColor: color, stopOpacity: '0.16' }),
            React.createElement('stop', { offset: '100%', stopColor: color, stopOpacity: '0' }))),
        baseline !== undefined
          ? React.createElement('line', {
            x1: 0, y1: baseline.toFixed(2), x2: width, y2: baseline.toFixed(2),
            className: 'stock-ticker-spark-baseline', vectorEffect: 'non-scaling-stroke',
          })
          : null,
        React.createElement('path', { d: area, fill: `url(#${gradientId})`, stroke: 'none' }),
        average !== undefined
          ? React.createElement('path', {
            d: average, fill: 'none', className: 'stock-ticker-spark-average', vectorEffect: 'non-scaling-stroke',
          })
          : null,
        React.createElement('path', {
          d: line, fill: 'none', stroke: color, strokeWidth: 0.8, vectorEffect: 'non-scaling-stroke', strokeLinejoin: 'round', strokeLinecap: 'round',
        }))
    }

    /** One row of the detail card. */
    const DetailRow = (props) =>
      React.createElement('div', { className: 'stock-ticker-detail-row' },
        React.createElement('span', { className: 'stock-ticker-detail-label' }, props.label),
        React.createElement('span', { className: 'stock-ticker-detail-value' }, props.value))

    /**
     * The full detail card for one instrument, shown while its row is hovered.
     *
     * Rendered as an absolutely positioned sibling of the row so opening it
     * never reflows the list underneath the pointer.
     */
    const DetailCard = (props) => {
      const { quote, series, text } = props
      const points = series?.points ?? []
      const digits = 2
      const cells = [
        [text('open'), priceText(quote.open)],
        [text('high'), priceText(quote.high)],
        [text('low'), priceText(quote.low)],
        [text('prevClose'), priceText(quote.previousClose)],
        [text('volume'), quote.volumeText ?? '--'],
        [text('turnover'), quote.turnoverText ?? '--'],
        [text('turnoverRate'), quote.turnoverRate === undefined ? '--' : `${quote.turnoverRate.toFixed(digits)}%`],
        [text('amplitude'), quote.amplitude === undefined ? '--' : `${quote.amplitude.toFixed(digits)}%`],
        [text('volumeRatio'), quote.volumeRatio === undefined ? '--' : quote.volumeRatio.toFixed(digits)],
        [text('marketCap'), quote.marketCapText ?? '--'],
        [text('floatCap'), quote.floatCapText ?? '--'],
        [text('pePb'), `${quote.pe === undefined ? '--' : quote.pe.toFixed(digits)} / ${quote.pb === undefined ? '--' : quote.pb.toFixed(digits)}`],
        [text('limitUp'), priceText(quote.limitUp)],
        [text('limitDown'), priceText(quote.limitDown)],
      ]
      void points
      return React.createElement('div', { className: 'stock-ticker-detail' },
        React.createElement('div', { className: 'stock-ticker-detail-head' },
          React.createElement('span', { className: 'stock-ticker-detail-name' }, quote.name),
          React.createElement('span', { className: 'stock-ticker-detail-code' }, `${quote.market === 'sh' ? 'SH' : quote.market === 'bj' ? 'BJ' : 'SZ'}${quote.code}`)),
        React.createElement('div', { className: 'stock-ticker-detail-grid' },
          cells.map(([label, value]) => React.createElement(DetailRow, { key: label, label, value }))))
    }

    /**
     * One watchlist row: symbol, intraday curve, price, and change.
     *
     * @param props - row data plus the hover callbacks owned by the window.
     */
    const StockRow = (props) => {
      const { item, quote, series, withCurve, text, onHover, onLeave } = props
      const change = quote?.changePercent
      const tone = typeof change !== 'number' || change === 0 ? 'flat' : change > 0 ? 'up' : 'down'
      // The curve strokes with the direction token; the CSS palette decides
      // which hue that is (see the ticker palette block in the stylesheet).
      const color = tone === 'up' ? tickerColor('up') : tone === 'down' ? tickerColor('down') : tickerColor('flat')
      const points = series?.points ?? []
      // Delegated `mouseover`/`mouseout` rather than `mouseenter`/`mouseleave`:
      // React synthesizes the enter/leave pair from the delegated events anyway,
      // and going direct keeps a pointer that moves between two rows from
      // clearing the hover on its way out of the first one.
      const move = (event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return
        onHover(item.market + item.code)
      }
      const leave = (event) => {
        if (event.currentTarget.contains(event.relatedTarget)) return
        onLeave()
      }
      return React.createElement('div', {
        className: `stock-ticker-row stock-ticker-${tone}`,
        onMouseOver: move,
        onMouseOut: leave,
      },
        React.createElement('div', { className: 'stock-ticker-ident' },
          React.createElement('span', { className: 'stock-ticker-name', title: item.name }, item.name || item.code),
          React.createElement('span', { className: 'stock-ticker-code' }, `${item.market.toUpperCase()}${item.code}`)),
        withCurve && points.length > 1
          ? React.createElement(Sparkline, {
            id: `${item.market}${item.code}`,
            points,
            previousClose: series?.previousClose ?? quote?.previousClose,
            color,
          })
          : React.createElement('div', { className: 'stock-ticker-spark stock-ticker-spark-empty' }),
        React.createElement('div', { className: 'stock-ticker-numbers' },
          React.createElement('span', { className: 'stock-ticker-price' }, priceText(quote?.price)),
          React.createElement('span', { className: 'stock-ticker-change' }, `${signed(change)}%`)))
    }

    /**
     * The mini-window mounted in `shell.overlay`.
     *
     * Owns position (dragged, view state), collapse state, hovered symbol, and
     * the polling loop. Settings arrive as a prop from the plugin body so this
     * component stays a pure function of its inputs plus React state.
     */
    const MiniWindow = (props) => {
      const { settings, text, t, onPin, writeError } = props
      const [collapsed, setCollapsed] = React.useState(false)
      // While a drag is in flight the pointer owns the position; otherwise the
      // stored pin does. Keeping them separate means a drag never fights the
      // settings round trip, and a pin saved on another surface still lands.
      const [dragging, setDragging] = React.useState(null)
      /**
       * Where the panel is on screen, for this session.
       *
       * Set by a drag, and kept after a pin is released so nothing jumps at the
       * moment the user changes their mind. Held apart from the settings
       * section so a refused pin write — a Host build that does not know the
       * field, a transient failure — cannot snap the panel back to its corner.
       */
      const [sessionPin, setSessionPin] = React.useState(null)
      // The viewport must be state rather than read during render: a placement
      // correction has to happen in the same commit as a resize, and render
      // must not depend on a mutable browser measurement.
      const [viewport, setViewport] = React.useState(() => ({ width: window.innerWidth, height: window.innerHeight }))
      const [quotes, setQuotes] = React.useState({})
      const [series, setSeries] = React.useState({})
      const [hovered, setHovered] = React.useState(null)
      const [status, setStatus] = React.useState('loading')
      const [asOf, setAsOf] = React.useState(null)
      const [tick, setTick] = React.useState(0)

      const drag = React.useRef(null)
      const rootRef = React.useRef(null)
      const settingsRef = React.useRef(settings)
      settingsRef.current = settings

      const watchlist = settings.watchlist
      const watchKey = watchlist.map(item => `${item.market}${item.code}`).join(',')
      const curveCount = Math.max(0, Math.min(settings.maxCurves, watchlist.length, CURVE_LIMIT))
      const hoveredItem = hovered === null ? undefined : watchlist.find(item => `${item.market}${item.code}` === hovered)

      // One poll per (watchlist, cadence, refresh generation). Quotes and curves
      // travel separately because curves only exist for the first `maxCurves`
      // entries and are cached on the host for considerably longer.
      React.useEffect(() => {
        if (watchlist.length === 0) {
          setQuotes({})
          setSeries({})
          setStatus('ready')
          return undefined
        }
        const controller = new AbortController()
        let cancelled = false
        // Consecutive whole-batch failures; a single miss must not surface.
        let failedPulls = 0
        // Whether any price has ever reached the board on this watchlist.
        let everShown = false
        const secids = watchlist.map(item => `${item.market}${item.code}`)
        const curveSecids = secids.slice(0, curveCount)

        /**
         * Read one batch of quotes.
         *
         * The provider drops a symbol it could not resolve, so this retries the
         * leftovers once before giving up on them: one flaky symbol otherwise
         * costs that row a whole refresh interval.
         *
         * @param wanted - symbol keys to read.
         * @returns the quotes the provider answered for, keyed by symbol.
         */
        const readQuotes = async (wanted) => {
          const found = new Map()
          let outstanding = wanted
          let throttled = false
          for (let attempt = 0; attempt < 2 && outstanding.length > 0; attempt += 1) {
            if (attempt > 0) await new Promise(resolve => setTimeout(resolve, 400))
            const body = await postJson('/quotes', { secids: outstanding }, controller.signal)
            if (cancelled) return { found, throttled }
            for (const quote of body.quotes ?? []) {
              if (quote !== null && typeof quote === 'object') found.set(`${quote.market}${quote.code}`, quote)
            }
            setAsOf(body.asOf ?? Date.now())
            outstanding = outstanding.filter(secid => !found.has(secid))
            throttled = body.throttled === true
            // The host is already backing off; asking again immediately is
            // exactly the behaviour that got it throttled.
            if (throttled) break
          }
          return { found, throttled }
        }

        /**
         * Settle the header status for one refresh.
         *
         * A board that already shows prices stays `ready` through a transient
         * miss, so a dropped request never flashes an outage over good data.
         * Only consecutive whole-batch failures escalate, and an empty board
         * reaches `error` on the first one because it has nothing to show.
         *
         * @param answered - how many symbols this refresh resolved.
         */
        const conclude = (answered, throttled) => {
          if (answered > 0) {
            failedPulls = 0
            everShown = true
            setStatus('ready')
            return
          }
          failedPulls += 1
          // A throttled feed is a known, recoverable state that the host is
          // already sleeping off, so it is reported without the harsher
          // threshold a genuine transport failure has to clear.
          if (throttled) {
            setStatus(everShown ? 'stale' : 'error')
            return
          }
          // A board that has never had a price has nothing to keep showing, so
          // it reports the outage at once; one with prices on screen holds its
          // tongue until the failures are clearly not a blip.
          if (!everShown || failedPulls >= 3) setStatus(everShown ? 'stale' : 'error')
        }

        const pull = async () => {
          let answered = 0
          let throttled = false
          try {
            const read = await readQuotes(secids)
            if (cancelled) return
            const { found } = read
            throttled = read.throttled
            answered = found.size
            // Sticky: a symbol the provider missed keeps the last price already
            // on screen, and only a symbol never yet seen falls back to a
            // name-only row. Without this a single failed refresh would wipe
            // every price on the board.
            setQuotes(previous => {
              const next = {}
              for (const secid of secids) {
                const quote = found.get(secid)
                if (quote !== undefined) {
                  next[secid] = quote
                } else if (previous[secid] !== undefined) {
                  next[secid] = previous[secid]
                } else {
                  next[secid] = { code: secid.slice(2), market: secid.slice(0, 2), name: '' }
                }
              }
              return next
            })
          } catch (error) {
            if (cancelled) return
            if (error instanceof DOMException && error.name === 'AbortError') return
            conclude(0, false)
            return
          }
          conclude(answered, throttled)
          // Curves ride the same refresh but are never allowed to fail it: a
          // missing series keeps the last drawn one.
          try {
            const pairs = await Promise.all(curveSecids.map(async secid => {
              try {
                return [secid, await postJson('/trends', { secid, ndays: 1 }, controller.signal)]
              } catch {
                return [secid, null]
              }
            }))
            if (cancelled) return
            setSeries(previous => {
              const next = {}
              for (const secid of curveSecids) {
                const fresh = pairs.find(([key]) => key === secid)?.[1]
                if (fresh !== null && fresh !== undefined) next[secid] = fresh
                else if (previous[secid] !== undefined) next[secid] = previous[secid]
              }
              return next
            })
          } catch {
            // A curve failure leaves the price rows intact; the next tick retries.
          }
        }

        void pull()
        // Polling slows to a crawl outside the session: the numbers are frozen
        // and the upstream provider does not need the traffic.
        const period = isTradingNow() ? settings.refreshMs : Math.max(settings.refreshMs * 6, 60_000)
        const timer = setInterval(() => { void pull() }, period)
        return () => {
          cancelled = true
          controller.abort()
          clearInterval(timer)
        }
      }, [watchKey, settings.refreshMs, curveCount, tick])

      // Hovering a row outside the curve budget fetches that one series on
      // demand, so the detail card is never curve-less for a watched symbol.
      React.useEffect(() => {
        if (hovered === null || series[hovered] !== undefined) return undefined
        if (!hoveredItem) return undefined
        const controller = new AbortController()
        let cancelled = false
        void (async () => {
          try {
            const body = await postJson('/trends', { secid: hovered, ndays: 1 }, controller.signal)
            if (cancelled) return
            setSeries(previous => (previous[hovered] !== undefined ? previous : { ...previous, [hovered]: body }))
          } catch {
            // Leaves the card without a curve; the price cells still render.
          }
        })()
        return () => { cancelled = true; controller.abort() }
      }, [hovered, hoveredItem, series])

      /**
       * Begin a pointer drag on the window header.
       *
       * Uses pointer capture so a fast drag that leaves the window keeps
       * delivering events, and commits one position per frame.
       */
      /**
       * Keep one position inside the viewport.
       *
       * The lower bounds leave the header reachable so a window dragged to an
       * edge can always be dragged back.
       *
       * @param left - proposed viewport x in CSS pixels.
       * @param top - proposed viewport y in CSS pixels.
       * @returns the clamped position.
       */
      const clampPosition = (left, top, box = viewport) => ({
        left: Math.round(Math.max(4, Math.min(Math.max(4, box.width - 140), left))),
        top: Math.round(Math.max(4, Math.min(Math.max(4, box.height - 44), top))),
      })

      React.useEffect(() => {
        const onResize = () => { setViewport({ width: window.innerWidth, height: window.innerHeight }) }
        window.addEventListener('resize', onResize)
        return () => { window.removeEventListener('resize', onResize) }
      }, [])

      const onDragStart = (event) => {
        if (event.button !== 0) return
        // Pinned means locked. The whole point of pinning is that the panel
        // stops moving, so a pinned header is not a drag handle at all; release
        // the pin first.
        if (settings.pinned !== null) return
        const node = rootRef.current
        if (node === null) return
        const box = node.getBoundingClientRect()
        drag.current = {
          pointerId: event.pointerId,
          dx: event.clientX - box.left,
          dy: event.clientY - box.top,
          frame: 0,
        }
        setDragging({ left: Math.round(box.left), top: Math.round(box.top) })
        // Pointer capture keeps a fast drag alive after the pointer leaves the
        // header, but it is an optional API: a host without it must still be
        // able to drag, so a missing or refusing implementation is ignored
        // rather than allowed to abort the gesture.
        const target = event.currentTarget
        if (typeof target.setPointerCapture === 'function') {
          try {
            target.setPointerCapture(event.pointerId)
          } catch {
            // The pointer is already gone, or capture is not permitted here.
          }
        }
      }

      const onDragMove = (event) => {
        const state = drag.current
        if (state === null || state.pointerId !== event.pointerId) return
        const left = event.clientX - state.dx
        const top = event.clientY - state.dy
        if (state.frame !== 0) return
        // One state commit per frame: a pointer stream is far faster than a
        // useful repaint, and this component re-renders a whole watchlist.
        state.frame = requestAnimationFrame(() => {
          state.frame = 0
          setDragging(clampPosition(left, top))
        })
      }

      const dragEnd = (event) => {
        const state = drag.current
        if (state === null || state.pointerId !== event.pointerId) return
        if (state.frame !== 0) cancelAnimationFrame(state.frame)
        drag.current = null
        // Read the landing spot from the node rather than from `dragging`: a
        // pointerup can arrive in the same frame as the final pointermove, so
        // the state set by that move may not be visible here yet. Leaving the
        // drag flag set would freeze the panel's position on every later render.
        const node = rootRef.current
        const box = node === null ? null : node.getBoundingClientRect()
        const landed = box === null ? null : clampPosition(box.left, box.top)
        setDragging(null)
        // Placement is a view change, not a decision: the panel stays where it
        // was dropped for this session, and the tack is what makes that
        // position durable. Persisting the drop automatically would flip the
        // tack's meaning under the user's finger — it would read "unpin" the
        // instant they finished dragging, so the obvious next click would
        // release the panel back to its default corner.
        if (landed !== null) setSessionPin(landed)
      }

      // A landed pin is also the panel's position for this session, so the
      // session record is kept in step with it. It is deliberately NOT cleared
      // when the pin lands: unlocking must leave the panel where it is, and a
      // reload is the event that should return it to the default corner.
      React.useEffect(() => {
        const stored = settings.pinned
        if (stored === null) return
        // Clamped on the way in: the session copy feeds the render directly, so
        // copying a position from a larger window verbatim would paint the
        // panel out of reach before the correction effect could fix it.
        const inside = clampPosition(stored.left, stored.top)
        setSessionPin(previous => (previous !== null && previous.left === inside.left && previous.top === inside.top
          ? previous
          : inside))
      }, [settings.pinned, viewport])

      // Persist a correction the render above already applied, so the document
      // stops carrying an unreachable position.
      React.useEffect(() => {
        if (settings.pinned === null) return
        const fixed = clampPosition(settings.pinned.left, settings.pinned.top)
        if (fixed.left === settings.pinned.left && fixed.top === settings.pinned.top) return
        void onPin(fixed)
      }, [settings.pinned, viewport, onPin])

      if (!settings.visible) return null

      const rows = watchlist.map((item, index) => React.createElement(StockRow, {
        key: `${item.market}${item.code}`,
        item,
        quote: quotes[`${item.market}${item.code}`],
        series: series[`${item.market}${item.code}`],
        withCurve: index < curveCount,
        text,
        onHover: setHovered,
        onLeave: () => { setHovered(null) },
      }))

      const hoveredQuote = hovered === null ? undefined : quotes[hovered]
      const symbol = hoveredItem === undefined
        ? undefined
        : `${hoveredItem.market}${hoveredItem.code}`

      // Precedence: the position under the pointer, then this session's
      // placement, then the stored pin, then the default corner. A stored pin
      // is corrected against the CURRENT viewport before it is applied, so a
      // position saved on a larger window can never paint the panel off screen
      // — the header is the only drag handle, so an off-screen panel would be
      // unrecoverable.
      // A live drag wins; then the session position; then the stored pin. Both
      // stored and session positions are viewport-clamped, so nothing can place
      // the panel beyond reach.
      const spot = dragging
        ?? sessionPin
        ?? (settings.pinned === null ? null : clampPosition(settings.pinned.left, settings.pinned.top))
      return React.createElement('div', {
        ref: rootRef,
        className: `stock-ticker-window${collapsed ? ' stock-ticker-collapsed' : ''}`
          + `${dragging === null ? '' : ' stock-ticker-dragging'}`
          + `${settings.pinned === null ? '' : ' stock-ticker-locked'}`,
        style: {
          opacity: String(settings.opacity ?? 1),
          ...(spot === null
            ? {}
            : { left: `${String(spot.left)}px`, top: `${String(spot.top)}px`, right: 'auto', bottom: 'auto' }),
        },
      },
        React.createElement('div', {
          className: 'stock-ticker-head',
          onPointerDown: onDragStart,
          onPointerMove: onDragMove,
          onPointerUp: dragEnd,
          onPointerCancel: dragEnd,
        },
          React.createElement('span', {
            className: status === 'error' || status === 'stale' ? 'stock-ticker-dot stock-ticker-dot-stale' : 'stock-ticker-dot',
          }),
          React.createElement('span', { className: 'stock-ticker-title' }, text('title')),
          React.createElement('span', { className: 'stock-ticker-status' },
            // `stale` keeps the last-good numbers on screen and says so, which
            // is more useful than replacing them with an apology.
            status === 'error' ? text('error')
              : status === 'stale' ? `${text('stale')} · ${text('updated')} ${asOf === null ? '--' : clockText(asOf)}`
                : asOf === null ? text('loading')
                  : `${isTradingNow() ? text('openSession') : text('closed')} · ${text('updated')} ${clockText(asOf)}`),
          React.createElement('button', {
            type: 'button',
            // The control's state is the durable pin and nothing else, so its
            // label always says what pressing it will do.
            className: `stock-ticker-icon-button${settings.pinned === null ? '' : ' stock-ticker-icon-button-active'}`,
            title: settings.pinned === null ? text('pin') : text('unpin'),
            'aria-label': settings.pinned === null ? text('pin') : text('unpin'),
            'aria-pressed': settings.pinned !== null,
            onPointerDown: event => { event.stopPropagation() },
            onClick: () => {
              // Unlock: the panel stays exactly where it is and simply becomes
              // draggable again. No geometry is read here — the session already
              // holds the position, and re-measuring would both race the layout
              // and yank the panel back to the section's value.
              if (settings.pinned !== null) {
                void onPin(null)
                return
              }
              // Lock: capture wherever the panel sits, wherever the user left
              // it, so a pin can be taken at any position.
              const node = rootRef.current
              const box = node === null ? null : node.getBoundingClientRect()
              const spot = box === null
                ? { left: 24, top: 24 }
                : clampPosition(box.left, box.top)
              setSessionPin(spot)
              void onPin(spot)
            },
          }, React.createElement(IconPin, null)),
          React.createElement('button', {
            type: 'button',
            className: 'stock-ticker-icon-button',
            title: text('refresh'),
            'aria-label': text('refresh'),
            onPointerDown: event => { event.stopPropagation() },
            onClick: () => { setTick(value => value + 1) },
          }, React.createElement(IconRefresh, null)),
          React.createElement('button', {
            type: 'button',
            className: 'stock-ticker-icon-button',
            title: collapsed ? text('expand') : text('collapse'),
            'aria-label': collapsed ? text('expand') : text('collapse'),
            'aria-expanded': !collapsed,
            onPointerDown: event => { event.stopPropagation() },
            onClick: () => { setCollapsed(value => !value) },
          }, collapsed ? React.createElement(IconChevronDown, null) : React.createElement(IconChevronUp, null))),

        !collapsed
          ? React.createElement('div', { className: 'stock-ticker-body' },
            watchlist.length === 0
              ? React.createElement('div', { className: 'stock-ticker-empty' }, text('empty'))
              : rows,
            hoveredQuote !== undefined && hoveredItem !== undefined
              ? React.createElement('div', {
                className: 'stock-ticker-detail-anchor',
                style: { top: `${String(34 + 30 * watchlist.findIndex(item => `${item.market}${item.code}` === symbol))}px` },
              }, React.createElement(DetailCard, {
                quote: hoveredQuote,
                series: symbol === undefined ? undefined : series[symbol],
                text,
              }))
              : null)
          : null)
    }

    /**
     * One editable row of the watchlist, with move/remove controls.
     */
    const WatchRow = (props) => {
      const { item, index, total, text, onMove, onRemove } = props
      return React.createElement('div', { className: 'stock-ticker-watch-row' },
        React.createElement('span', { className: 'stock-ticker-watch-order' }, String(index + 1)),
        React.createElement('span', { className: 'stock-ticker-watch-name' }, item.name || item.code),
        React.createElement('span', { className: 'stock-ticker-watch-code' }, `${item.market.toUpperCase()}${item.code}`),
        React.createElement(Button, {
          size: 'sm',
          variant: 'ghost',
          disabled: index === 0,
          title: text('moveUp'),
          'aria-label': text('moveUp'),
          onClick: () => { onMove(index, index - 1) },
        }, React.createElement(IconChevronUp, null)),
        React.createElement(Button, {
          size: 'sm',
          variant: 'ghost',
          disabled: index === total - 1,
          title: text('moveDown'),
          'aria-label': text('moveDown'),
          onClick: () => { onMove(index, index + 1) },
        }, React.createElement(IconChevronDown, null)),
        React.createElement(Button, {
          size: 'sm',
          variant: 'ghost',
          title: text('remove'),
          'aria-label': text('remove'),
          onClick: () => { onRemove(index) },
        }, React.createElement(IconTrash, null)))
    }

    /**
     * The settings page registered into `settings.section`.
     *
     * Local draft state mirrors the durable section so a half-typed search or a
     * number mid-edit never round-trips; every committed change goes through
     * `settings.set`, which is revision-fenced by the host.
     */
    const SettingsPage = (props) => {
      const { settings, write, locale, text } = props
      const [query, setQuery] = React.useState('')
      const [results, setResults] = React.useState([])
      const [searching, setSearching] = React.useState(false)
      const [searched, setSearched] = React.useState(false)
      const [saving, setSaving] = React.useState(false)
      const [failure, setFailure] = React.useState(undefined)

      const run = React.useCallback((operation) => {
        setSaving(true)
        setFailure(undefined)
        Promise.resolve(operation)
          .catch(error => { setFailure(error instanceof Error ? error.message : String(error)) })
          .finally(() => { setSaving(false) })
      }, [])

      React.useEffect(() => {
        const trimmed = query.trim()
        if (trimmed.length === 0) {
          setResults([])
          setSearched(false)
          return undefined
        }
        const controller = new AbortController()
        const timer = setTimeout(() => {
          setSearching(true)
          void (async () => {
            try {
              const body = await postJson('/search', { query: trimmed }, controller.signal)
              setResults(Array.isArray(body.results) ? body.results : [])
            } catch {
              setResults([])
            } finally {
              setSearching(false)
              setSearched(true)
            }
          })()
        }, 250)
        return () => { controller.abort(); clearTimeout(timer) }
      }, [query])

      const keys = new Set(settings.watchlist.map(item => `${item.market}${item.code}`))

      const add = (candidate) => {
        const key = `${candidate.market}${candidate.code}`
        if (keys.has(key) || settings.watchlist.length >= MAX_WATCHLIST) return
        run(write('watchlist', [...settings.watchlist, { code: candidate.code, name: candidate.name, market: candidate.market }]))
      }

      const remove = (index) => {
        const next = settings.watchlist.filter((_, position) => position !== index)
        run(write('watchlist', next))
      }

      const move = (from, to) => {
        if (to < 0 || to >= settings.watchlist.length) return
        const next = [...settings.watchlist]
        const [moved] = next.splice(from, 1)
        next.splice(to, 0, moved)
        run(write('watchlist', next))
      }

      return React.createElement('div', { className: 'stock-ticker-page' },
        React.createElement('h2', { className: 'stock-ticker-page-title' }, text('settingsTitle')),
        React.createElement('p', { className: 'stock-ticker-page-intro' }, text('settingsIntro')),

        React.createElement('div', { className: 'stock-ticker-field' },
          React.createElement('div', { className: 'stock-ticker-field-text' },
            React.createElement('div', { className: 'stock-ticker-field-title' }, text('visibleTitle')),
            React.createElement('div', { className: 'stock-ticker-field-desc' }, text('visibleDesc'))),
          React.createElement(Button, {
            variant: settings.visible ? 'primary' : 'outline',
            size: 'sm',
            'aria-pressed': settings.visible,
            onClick: () => { run(write('visible', !settings.visible)) },
          }, settings.visible ? locale === 'en' ? 'On' : '已开启' : locale === 'en' ? 'Off' : '已关闭')),

        React.createElement('div', { className: 'stock-ticker-field' },
          React.createElement('div', { className: 'stock-ticker-field-text' },
            React.createElement('div', { className: 'stock-ticker-field-title' }, text('opacityTitle')),
            React.createElement('div', { className: 'stock-ticker-field-desc' }, text('opacityDesc'))),
          React.createElement('div', { className: 'stock-ticker-slider' },
            React.createElement('input', {
              type: 'range',
              min: '35',
              max: '100',
              step: '5',
              value: String(Math.round(settings.opacity * 100)),
              'aria-label': text('opacityTitle'),
              onChange: event => {
                const percent = Number(event.target.value)
                if (!Number.isFinite(percent)) return
                run(write('opacity', Math.min(1, Math.max(0.35, percent / 100))))
              },
            }),
            React.createElement('span', { className: 'stock-ticker-slider-value' },
              `${String(Math.round(settings.opacity * 100))}%`))),

        React.createElement('div', { className: 'stock-ticker-field' },
          React.createElement('div', { className: 'stock-ticker-field-text' },
            React.createElement('div', { className: 'stock-ticker-field-title' }, text('pinnedTitle')),
            React.createElement('div', { className: 'stock-ticker-field-desc' }, text('pinnedDesc'))),
          React.createElement('div', { className: 'stock-ticker-pin-actions' },
            React.createElement('span', { className: 'stock-ticker-count' },
              settings.pinned === null
                ? text('floating')
                : `${text('pinned')} · ${String(settings.pinned.left)}, ${String(settings.pinned.top)}`),
            React.createElement(Button, {
              size: 'sm',
              variant: settings.pinned === null ? 'outline' : 'primary',
              'aria-pressed': settings.pinned !== null,
              onClick: () => { run(write('pinned', settings.pinned === null ? { left: 24, top: 24 } : null)) },
            }, settings.pinned === null ? text('pin') : text('unpin')),
            React.createElement(Button, {
              size: 'sm',
              variant: 'ghost',
              disabled: settings.pinned === null,
              onClick: () => { run(write('pinned', null)) },
            }, text('resetPosition')))),

        React.createElement('div', { className: 'stock-ticker-field' },
          React.createElement('div', { className: 'stock-ticker-field-text' },
            React.createElement('div', { className: 'stock-ticker-field-title' }, text('countTitle')),
            React.createElement('div', { className: 'stock-ticker-field-desc' }, text('countDesc'))),
          React.createElement(Input, {
            type: 'number',
            min: 1,
            max: MAX_WATCHLIST,
            value: String(settings.maxCurves),
            style: { width: '72px' },
            onChange: event => {
              const next = Number(event.target.value)
              if (!Number.isInteger(next) || next < 1 || next > MAX_WATCHLIST) return
              run(write('maxCurves', next))
            },
          })),

        React.createElement('div', { className: 'stock-ticker-field' },
          React.createElement('div', { className: 'stock-ticker-field-text' },
            React.createElement('div', { className: 'stock-ticker-field-title' }, text('refreshTitle')),
            React.createElement('div', { className: 'stock-ticker-field-desc' }, text('refreshDesc'))),
          React.createElement('div', { className: 'stock-ticker-segmented' },
            REFRESH_OPTIONS.map(option => React.createElement(Button, {
              key: option.id,
              size: 'sm',
              variant: String(settings.refreshMs) === option.id ? 'primary' : 'outline',
              'aria-pressed': String(settings.refreshMs) === option.id,
              onClick: () => { run(write('refreshMs', Number(option.id))) },
            }, locale === 'en' ? option.en : option.zh)))),

        React.createElement('div', { className: 'stock-ticker-section-head' },
          React.createElement('div', { className: 'stock-ticker-field-title' }, text('watchlistTitle')),
          React.createElement('span', { className: 'stock-ticker-count' }, text('totalCount', { count: settings.watchlist.length }))),

        React.createElement('div', { className: 'stock-ticker-search' },
          React.createElement(Input, {
            value: query,
            placeholder: text('searchPlaceholder'),
            icon: React.createElement(IconSearch, null),
            onChange: event => { setQuery(event.target.value) },
          })),
        searching ? React.createElement('div', { className: 'stock-ticker-hint' }, text('loading')) : null,
        searched && !searching && results.length === 0
          ? React.createElement('div', { className: 'stock-ticker-hint' }, text('searchEmpty'))
          : null,
        results.length > 0
          ? React.createElement('div', { className: 'stock-ticker-results' },
            results.map(candidate => {
              const key = `${candidate.market}${candidate.code}`
              const present = keys.has(key)
              return React.createElement('div', { key, className: 'stock-ticker-result' },
                React.createElement('span', { className: 'stock-ticker-result-name' }, candidate.name),
                React.createElement('span', { className: 'stock-ticker-result-code' }, `${key.toUpperCase()} · ${candidate.type}`),
                React.createElement(Button, {
                  size: 'sm',
                  variant: present ? 'ghost' : 'outline',
                  disabled: present || settings.watchlist.length >= MAX_WATCHLIST,
                  icon: present ? undefined : React.createElement(IconPlus, null),
                  onClick: () => { add(candidate) },
                }, present ? text('already') : text('add')))
            }))
          : null,

        React.createElement('div', { className: 'stock-ticker-watchlist' },
          settings.watchlist.length === 0
            ? React.createElement('div', { className: 'stock-ticker-hint' }, text('empty'))
            : settings.watchlist.map((item, index) => React.createElement(WatchRow, {
              key: `${item.market}${item.code}`,
              item,
              index,
              total: settings.watchlist.length,
              text,
              onMove: move,
              onRemove: remove,
            }))),

        saving || failure !== undefined
          ? React.createElement('div', { className: `stock-ticker-hint${failure === undefined ? '' : ' stock-ticker-hint-error'}` },
            failure === undefined ? text('saving') : failure)
          : null,

        // Which build each half is running. The browser bundle is only re-read
        // on a page reload, so this is the difference between "the fix did not
        // work" and "the page is still running the previous bundle".
        React.createElement('div', { className: 'stock-ticker-build' },
          `${text('clientBuild')} ${CLIENT_BUILD} · ${text('hostBuild')} ${props.hostBuild ?? 'unknown'}`))
    }

    /**
     * Defaults used before the host's first settings view arrives.
     */
    const fallbackSettings = {
      watchlist: [],
      maxCurves: 6,
      refreshMs: 15_000,
      visible: true,
      opacity: 1,
      pinned: null,
    }

    /** Most transparent the panel may be drawn; mirrors the host validator. */
    const MIN_OPACITY = 0.35

    /**
     * Coerce one stored pin into a usable position.
     *
     * @param value - candidate `{ left, top }`.
     * @returns the position, or `null` when absent or unusable.
     */
    const adoptPin = (value) => {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
      if (!Number.isFinite(value.left) || !Number.isFinite(value.top)) return null
      return { left: Math.round(value.left), top: Math.round(value.top) }
    }

    /**
     * Read one resolved section into the shape both surfaces consume.
     *
     * @param value - the settings scope's current value, if any.
     * @returns a fully-populated settings view.
     */
    const adopt = (value) => {
      if (value === null || typeof value !== 'object') return fallbackSettings
      const section = value
      const list = Array.isArray(section.watchlist) ? section.watchlist : []
      return {
        watchlist: list
          .filter(item => item !== null && typeof item === 'object' && typeof item.code === 'string')
          .map(item => ({
            code: item.code,
            name: typeof item.name === 'string' ? item.name : '',
            market: item.market === 'sh' || item.market === 'sz' || item.market === 'bj' ? item.market : 'sh',
          })),
        maxCurves: Number.isInteger(section.maxCurves) ? section.maxCurves : fallbackSettings.maxCurves,
        refreshMs: Number.isInteger(section.refreshMs) ? section.refreshMs : fallbackSettings.refreshMs,
        visible: section.visible !== false,
        // Resolved defensively rather than trusted: a section written by an
        // older build of this plugin has neither field.
        opacity: typeof section.opacity === 'number' && section.opacity >= MIN_OPACITY && section.opacity <= 1
          ? section.opacity
          : 1,
        pinned: adoptPin(section.pinned),
      }
    }

    /**
     * Local mirror of the durable settings section.
     *
     * The section is read and written through this plugin's own `/config`
     * routes rather than the settings RPC: the Host's Web settings surface is
     * an allowlist of in-box namespaces, so an out-of-tree namespace answers
     * `settings-not-exposed`. Persistence is still the settings provider's
     * document and its atomic writer — only the transport is ours.
     *
     * Concurrent surfaces (mini-window and settings page) share one copy, so a
     * write notifies every subscriber at once.
     *
     * @param fallback - the section to use before the first successful read.
     * @returns a hook-shaped reader plus the field writer.
     */
    const createConfigStore = (fallback) => {
      let snapshot = { status: 'loading', config: fallback, hostBuild: undefined, writeError: undefined }
      const listeners = new Set()
      const publish = (next) => {
        snapshot = next
        for (const listener of listeners) listener()
      }
      const load = () => fetch(`${API}/config`, { headers: { accept: 'application/json' } })
        .then(async response => {
          if (!response.ok) throw new Error(`config -> HTTP ${String(response.status)}`)
          const body = await response.json()
          publish({ status: 'ready', config: adopt(body.config), hostBuild: body.build })
        })
        .catch(() => { publish({ status: 'error', config: snapshot.config, hostBuild: snapshot.hostBuild }) })

      /** How often a mounted surface re-reads the section on its own. */
      const REFRESH_MS = 20_000

      const useConfig = () => {
        const [current, setCurrent] = React.useState(snapshot)
        React.useEffect(() => {
          const listener = () => { setCurrent(snapshot) }
          listeners.add(listener)
          void load()
          // Two independent paths keep the surfaces in step: `write` publishes
          // to every listener in this page immediately, and this poll covers a
          // change made anywhere else — another tab, another window, or the
          // settings document edited by hand. Without the poll the mini-window
          // kept the section it read at mount forever, so a visibility or
          // opacity change made on the settings page never reached it.
          const timer = setInterval(() => { void load() }, REFRESH_MS)
          const onFocus = () => { void load() }
          window.addEventListener('focus', onFocus)
          return () => {
            listeners.delete(listener)
            clearInterval(timer)
            window.removeEventListener('focus', onFocus)
          }
        }, [])
        return current
      }

      const write = async (field, value) => {
        const response = await fetch(`${API}/config`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ [field]: value }),
        })
        const body = await response.json().catch(() => ({}))
        if (!response.ok) {
          // Surface the rejection: a stored field the running Host does not
          // know about is how a half-updated deployment announces itself, and
          // silently ignoring it is what makes the UI look broken.
          const message = typeof body.error === 'string' ? body.error : `HTTP ${String(response.status)}`
          // Recorded on the snapshot rather than thrown: callers are event
          // handlers, and a rejection there is an unhandled rejection the user
          // never sees — while the panel that reported it stays visibly wrong.
          publish({ ...snapshot, writeError: message })
          return
        }
        publish({ status: 'ready', config: adopt(body.config), hostBuild: body.build, writeError: undefined })
        return
      }

      return { useConfig, write, refresh: load }
    }

    /** Stylesheet, injected once and reclaimed by the loader with this bundle. */
    const CSS = `
.stock-ticker-window{--stock-ticker-up:var(--dsw-alias-state-error-primary);--stock-ticker-down:var(--dsw-alias-state-success-primary);--stock-ticker-flat:var(--dsw-alias-label-tertiary);position:absolute;right:24px;bottom:24px;z-index:30;box-sizing:border-box;width:268px;display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-inverted);border-radius:12px;background:var(--dsw-specific-menu);box-shadow:var(--dsw-shadow-lv3);color:var(--dsw-alias-label-primary);font-family:var(--dsw-font-family);font-size:12px;line-height:18px;font-synthesis-weight:none;font-variant-ligatures:none;text-rendering:geometricPrecision;-webkit-font-smoothing:antialiased;overflow:visible}
.stock-ticker-head{display:flex;align-items:center;gap:6px;height:34px;padding:0 6px 0 10px;border-bottom:1px solid var(--dsw-alias-border-l1);cursor:grab;user-select:none;touch-action:none}
/* A pinned panel is locked, so the header must not advertise a drag. */
.stock-ticker-locked .stock-ticker-head{cursor:default}
.stock-ticker-locked .stock-ticker-head:active{cursor:default}
.stock-ticker-collapsed .stock-ticker-head{border-bottom:0}
.stock-ticker-head:active{cursor:grabbing}
.stock-ticker-dot{flex:none;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-state-success-primary)}
.stock-ticker-dot-stale{background:var(--dsw-alias-state-warn-primary)}
.stock-ticker-title{flex:none;font-weight:600;font-size:12px}
.stock-ticker-status{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:var(--dsw-alias-label-tertiary);font-size:11px}
.stock-ticker-icon-button{display:inline-flex;align-items:center;justify-content:center;flex:none;width:22px;height:22px;padding:0;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer}
.stock-ticker-icon-button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
.stock-ticker-icon-button-active{color:var(--dsw-alias-brand-primary)}
/* An unpinned tack is muted so the pinned one reads as the engaged state; the
   shape stays identical, which keeps one recognisable control. */
.stock-ticker-icon-button[aria-pressed=false]{color:var(--dsw-alias-label-tertiary)}
.stock-ticker-icon-button[aria-pressed=false]:hover{color:var(--dsw-alias-label-primary)}
/* No transitions while dragging: the window is repositioned every frame, and a
   transition would make it lag the pointer. */
.stock-ticker-dragging{transition:none;user-select:none}
.stock-ticker-dragging .stock-ticker-head{cursor:grabbing}
.stock-ticker-body{position:relative;padding:4px}
.stock-ticker-row{display:flex;align-items:center;gap:8px;height:30px;padding:0 6px;border-radius:8px;cursor:default}
.stock-ticker-row:hover{background:var(--dsw-alias-interactive-bg-hover)}
.stock-ticker-ident{display:flex;flex-direction:column;justify-content:center;flex:1 1 auto;min-width:0;line-height:13px}
.stock-ticker-name{overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-weight:400}
.stock-ticker-code{color:var(--dsw-alias-label-tertiary);font-size:10px;line-height:11px}
.stock-ticker-spark{flex:none;width:108px;height:22px;display:block}
.stock-ticker-spark-empty{opacity:.25;background:linear-gradient(90deg,transparent,var(--dsw-alias-border-l1),transparent)}
.stock-ticker-spark-baseline{stroke:var(--dsw-alias-border-l2);stroke-width:1;stroke-dasharray:2 2}
.stock-ticker-spark-average{stroke:var(--dsw-alias-state-warn-primary);stroke-width:1;opacity:.75}
.stock-ticker-numbers{flex:none;display:flex;flex-direction:column;align-items:flex-end;width:58px;line-height:13px}
.stock-ticker-price{font-variant-numeric:tabular-nums;font-weight:500}
.stock-ticker-change{font-variant-numeric:tabular-nums;font-size:11px}
.stock-ticker-up .stock-ticker-price,.stock-ticker-up .stock-ticker-change{color:var(--stock-ticker-up)}
.stock-ticker-down .stock-ticker-price,.stock-ticker-down .stock-ticker-change{color:var(--stock-ticker-down)}
.stock-ticker-flat .stock-ticker-price,.stock-ticker-flat .stock-ticker-change{color:var(--stock-ticker-flat)}
.stock-ticker-empty{padding:16px 10px;color:var(--dsw-alias-label-tertiary);text-align:center}
.stock-ticker-detail-anchor{position:absolute;left:6px;z-index:40}
.stock-ticker-detail{width:264px;padding:10px;border:1px solid var(--dsw-alias-border-inverted);border-radius:10px;background:var(--dsw-alias-bg-layer-3);box-shadow:var(--dsw-shadow-lv3)}
.stock-ticker-detail-head{display:flex;align-items:baseline;justify-content:space-between;gap:8px;margin-bottom:8px}
.stock-ticker-detail-name{font-weight:600;font-size:13px}
.stock-ticker-detail-code{color:var(--dsw-alias-label-tertiary);font-size:11px}
.stock-ticker-detail-grid{display:grid;grid-template-columns:1fr 1fr;gap:2px 14px}
.stock-ticker-detail-row{display:flex;align-items:baseline;justify-content:space-between;gap:8px;min-width:0}
/* Labels may shrink; a value never breaks across two lines, because a wrapped
   "1217.61亿" reads as two different numbers. */
.stock-ticker-detail-label{flex:0 1 auto;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:var(--dsw-alias-label-tertiary);font-size:11px}
.stock-ticker-detail-value{flex:none;white-space:nowrap;font-variant-numeric:tabular-nums;font-size:11px}
.stock-ticker-page{display:flex;flex-direction:column;gap:14px;max-width:640px}
.stock-ticker-page-title{margin:0;font-size:16px;font-weight:600}
.stock-ticker-page-intro{margin:0;color:var(--dsw-alias-label-secondary)}
.stock-ticker-field{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:10px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:10px}
.stock-ticker-field-text{min-width:0}
.stock-ticker-field-title{font-weight:500}
.stock-ticker-field-desc{margin-top:2px;color:var(--dsw-alias-label-tertiary);font-size:11px;line-height:16px}
.stock-ticker-segmented{display:flex;gap:6px;flex:none}
.stock-ticker-slider{display:flex;align-items:center;gap:10px;flex:none}
.stock-ticker-slider input[type=range]{width:132px;accent-color:var(--dsw-alias-brand-primary)}
.stock-ticker-slider-value{width:38px;text-align:right;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums;font-size:11px}
.stock-ticker-pin-actions{display:flex;align-items:center;gap:8px;flex:none}
.stock-ticker-section-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-top:4px}
.stock-ticker-count{color:var(--dsw-alias-label-tertiary);font-size:11px}
.stock-ticker-search{max-width:340px}
.stock-ticker-hint{color:var(--dsw-alias-label-tertiary);font-size:11px}
.stock-ticker-hint-error{color:var(--dsw-alias-state-error-primary)}
.stock-ticker-build{margin-top:6px;color:var(--dsw-alias-label-tertiary);font-size:11px;font-variant-numeric:tabular-nums}
.stock-ticker-results,.stock-ticker-watchlist{display:flex;flex-direction:column;gap:4px}
.stock-ticker-result,.stock-ticker-watch-row{display:flex;align-items:center;gap:10px;padding:6px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px}
.stock-ticker-result-name,.stock-ticker-watch-name{flex:1;min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;font-weight:400}
.stock-ticker-result-code,.stock-ticker-watch-code,.stock-ticker-watch-order{color:var(--dsw-alias-label-tertiary);font-size:11px;font-variant-numeric:tabular-nums}
.stock-ticker-watch-order{width:16px}
.stock-ticker-watch-code{width:78px}
`

    /**
     * Inject the stylesheet once per document.
     *
     * @returns a disposer removing the owned tag.
     */
    const insertStyles = () => {
      const existing = document.querySelector('style[data-plugin-css="dsh-stock-ticker/client"]')
      if (existing !== null) return () => {}
      const tag = document.createElement('style')
      tag.dataset.plugin = 'dsh-stock-ticker'
      tag.dataset.pluginCss = 'dsh-stock-ticker/client'
      tag.textContent = CSS
      document.head.appendChild(tag)
      return () => { tag.remove() }
    }

    /** Required client services: the slot seats and the copy registry. */
    const inject = ['slots', 'locale']

    /**
     * Client plugin body: contribute the mini-window and the settings page,
     * both reading one shared mirror of the durable settings section.
     *
     * @param ctx - the browser-side cordis context.
     */
    function apply(ctx) {
      ctx.effect(insertStyles, 'stock-ticker: stylesheet')
      const store = createConfigStore(fallbackSettings)
      const t = ctx.locale.bind(LOCALE_NS)

      ctx.slots.inject('shell.overlay', () => ctx.slots.register({
        name: 'shell.overlay',
        id: 'stock-ticker',
        order: 100,
        locale: LOCALE_NS,
      }, (slotProps) => {
        const state = store.useConfig()
        return React.createElement(MiniWindow, {
          settings: state.config,
          text: createText(slotProps.t ?? t, ctx.locale.getLocale().active),
          t,
          writeError: state.writeError,
          onPin: (pinned) => store.write('pinned', pinned),
        })
      }))

      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'stocks',
        order: 30,
        label: () => t('nav'),
        locale: LOCALE_NS,
      }, (slotProps) => {
        const state = store.useConfig()
        const text = createText(slotProps.t ?? t, ctx.locale.getLocale().active)
        if (state.status === 'loading') {
          return React.createElement('div', { className: 'stock-ticker-page' },
            React.createElement('div', { className: 'stock-ticker-hint' }, text('loading')))
        }
        return React.createElement(SettingsPage, {
          settings: state.config,
          write: store.write,
          locale: ctx.locale.getLocale().active,
          text,
          hostBuild: state.hostBuild,
        })
      }))
    }

    /**
     * Register the dictionaries. Kept beside `apply` so the loader's factory
     * exports match the shape every other client bundle publishes.
     *
     * @param ctx - the browser-side cordis context.
     */
    const registerLocale = (ctx) => {
      ctx.effect(() => ctx.locale.register(LOCALE_NS, { zh, en }), 'stock-ticker: dictionaries')
    }

    exports.apply = (ctx) => {
      registerLocale(ctx)
      apply(ctx)
    }
    exports.inject = inject
    return module.exports
  },
})
