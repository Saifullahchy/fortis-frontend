import React from 'react'
import ReactDOM from 'react-dom/client'
import { Provider } from 'react-redux'
import { BrowserRouter } from 'react-router-dom'
import { store } from './store'
import App from './app/App'
import { AIProvider } from './contexts/ai/AIContext'
import './styles.css'
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Provider store={store}>
      <AIProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </AIProvider>
    </Provider>
  </React.StrictMode>,
)
