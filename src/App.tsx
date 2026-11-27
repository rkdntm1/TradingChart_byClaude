import { useState } from 'react'
import Chart from './components/Chart'
import { INTERVALS, type Interval } from './lib/upbit'
import './App.css'

export default function App() {
  const [market] = useState('KRW-BTC')
  const [interval, setInterval] = useState<Interval>('15m')

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" />
          ChartView
        </div>
        <div className="symbol">
          <span className="symbol-name">{market}</span>
        </div>
      </header>

      <main className="main">
        <div className="toolbar">
          {INTERVALS.map((iv) => (
            <button key={iv.id} className={`tb-btn ${iv.id === interval ? 'on' : ''}`} onClick={() => setInterval(iv.id)}>
              {iv.label}
            </button>
          ))}
        </div>
        <Chart market={market} interval={interval} />
      </main>

      <aside className="side" />
    </div>
  )
}
