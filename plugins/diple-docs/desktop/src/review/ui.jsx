// ui: the app's own components when the host provides them, plain elements
// otherwise (older hosts, the jsdom test stub). Namespace import on purpose:
// a NAMED import of a missing SDK export would fail the whole module load.
import * as SDK from '@hermes/plugin-sdk'
import { Component } from 'react'

import { markdownRenderer } from './selfcheck.js'

const cx = (...c) => c.filter(Boolean).join(' ')

export function Button({ variant = 'outline', size = 'sm', className, children, ...rest }) {
  if (typeof SDK.Button === 'function' || typeof SDK.Button === 'object')
    return <SDK.Button variant={variant} size={size} className={cx('er-btn', className)} {...rest}>{children}</SDK.Button>
  return (
    <button type="button" className={cx('er-btn', 'er-btn-fallback', `er-btn-${variant}`, className)} {...rest}>
      {children}
    </button>
  )
}

export function Tip({ label, children }) {
  if (SDK.Tip && label) return <SDK.Tip label={label}>{children}</SDK.Tip>
  return children
}

export function Segmented({ options, value, onChange, label }) {
  if (SDK.SegmentedControl) return <SDK.SegmentedControl options={options} value={value} onChange={onChange} aria-label={label} />
  return (
    <div role="radiogroup" aria-label={label} className="er-seg">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          className={cx('er-seg-btn', value === o.id && 'is-active')}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Toggle({ checked, onChange, label, id }) {
  if (SDK.Switch) return <SDK.Switch id={id} checked={checked} onCheckedChange={onChange} aria-label={label} />
  return <input id={id} type="checkbox" checked={checked} aria-label={label} onChange={(e) => onChange(e.target.checked)} />
}

export function Icon({ name }) {
  if (SDK.Codicon) return <SDK.Codicon name={name} />
  return null
}


const plain = (text) => <div className="er-md-fallback">{text}</div>

/** A renderer that throws on some odd input must not take the card (or the page) down (XR-07). */
class RenderGuard extends Component {
  constructor(props) {
    super(props)
    this.state = { failed: false }
  }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidUpdate(prev) {
    if (prev.text !== this.props.text && this.state.failed) this.setState({ failed: false })
  }
  render() {
    return this.state.failed ? plain(this.props.text) : this.props.children
  }
}

export function Markdown({ text }) {
  const which = markdownRenderer(SDK)
  if (which === 'MessageTextContent')
    return (
      <RenderGuard text={text}>
        <SDK.MessageTextContent text={text} media={false} />
      </RenderGuard>
    )
  if (which === 'Streamdown')
    return (
      <RenderGuard text={text}>
        <SDK.Streamdown>{text}</SDK.Streamdown>
      </RenderGuard>
    )
  return plain(text)
}

export function Spinner() {
  if (SDK.GlyphSpinner) return <SDK.GlyphSpinner />
  return <span className="er-spinner" aria-hidden="true" />
}

export { cx }

/** A dropdown for a setting with many options (the language): the host's
 *  Select (Radix) when present, else a native <select>. options: [{ id, label, dir?, lang? }] */
export function Choice({ value, options, onChange, label, id }) {
  const { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } = SDK
  if ([Select, SelectTrigger, SelectValue, SelectContent, SelectItem].every((c) => typeof c === 'function' || (c && typeof c === 'object'))) {
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger aria-label={label} id={id} className="er-choice" data-diple-docs-choice="">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.id} value={o.id} dir={o.dir} lang={o.lang}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    )
  }
  return (
    <select id={id} className="er-choice er-choice-native" data-diple-docs-choice="" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
      {options.map((o) => (
        <option key={o.id} value={o.id} dir={o.dir} lang={o.lang}>
          {o.label}
        </option>
      ))}
    </select>
  )
}
