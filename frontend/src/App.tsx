import { Link, Route, Routes } from 'react-router-dom'
import './App.css'
import AdminDashboard from './pages/AdminDashboard'
import UserDashboard from './pages/UserDashboard'
import { useWeb3 } from './useWeb3'

function truncateAddress(address: string) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function App() {
  const { account, connectWallet, disconnectWallet, isMetaMaskAvailable, isWrongNetwork, switchNetwork } = useWeb3()

  return (
    <div className="app-shell">
      <nav className="navbar">
        <Link className="brand" to="/">
          DeFi Term Deposit
        </Link>

        <div className="nav-actions">
          <div className="nav-links">
            <Link to="/">User Dashboard</Link>
            <Link to="/admin">Admin Dashboard</Link>
          </div>

          {account ? (
            <div className="wallet-session">
              <span className="wallet-address">{truncateAddress(account)}</span>
              <button className="wallet-button" type="button" onClick={disconnectWallet}>
                Disconnect
              </button>
            </div>
          ) : (
            <button className="wallet-button" type="button" onClick={connectWallet} disabled={!isMetaMaskAvailable}>
              {isMetaMaskAvailable ? 'Connect Wallet' : 'MetaMask Not Found'}
            </button>
          )}
        </div>
      </nav>

      {isWrongNetwork ? (
        <div className="network-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="network-modal-title">
          <section className="network-modal">
            <p className="eyebrow">Wrong Network</p>
            <h1 id="network-modal-title">Switch to Sepolia</h1>
            <p>Please switch to the Sepolia testnet to use this application.</p>
            <button className="primary-button" type="button" onClick={() => void switchNetwork()}>
              Switch to Sepolia
            </button>
          </section>
        </div>
      ) : (
        <main className="main-content">
          <Routes>
            <Route path="/" element={<UserDashboard />} />
            <Route path="/admin" element={<AdminDashboard />} />
          </Routes>
        </main>
      )}
    </div>
  )
}

export default App
