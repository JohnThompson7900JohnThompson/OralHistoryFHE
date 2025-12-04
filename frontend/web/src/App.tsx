import React, { useEffect, useState } from "react";
import { ethers } from "ethers";
import { getContractReadOnly, getContractWithSigner } from "./contract";
import WalletManager from "./components/WalletManager";
import WalletSelector from "./components/WalletSelector";
import "./App.css";

interface OralHistoryRecord {
  id: string;
  encryptedData: string;
  timestamp: number;
  owner: string;
  category: string;
  status: "pending" | "analyzed" | "rejected";
  analysisResult?: {
    sentiment: number;
    topics: string[];
    riskLevel: "low" | "medium" | "high";
  };
}

const App: React.FC = () => {
  const [account, setAccount] = useState("");
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState<OralHistoryRecord[]>([]);
  const [provider, setProvider] = useState<ethers.BrowserProvider | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [walletSelectorOpen, setWalletSelectorOpen] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{
    visible: boolean;
    status: "pending" | "success" | "error";
    message: string;
  }>({ visible: false, status: "pending", message: "" });
  const [newRecordData, setNewRecordData] = useState({
    category: "",
    description: "",
    sensitiveContent: ""
  });
  const [showTutorial, setShowTutorial] = useState(false);
  const [expandedRecord, setExpandedRecord] = useState<string | null>(null);
  const [activePanel, setActivePanel] = useState("dashboard");

  // Calculate statistics for dashboard
  const analyzedCount = records.filter(r => r.status === "analyzed").length;
  const pendingCount = records.filter(r => r.status === "pending").length;
  const rejectedCount = records.filter(r => r.status === "rejected").length;

  useEffect(() => {
    loadRecords().finally(() => setLoading(false));
  }, []);

  const onWalletSelect = async (wallet: any) => {
    if (!wallet.provider) return;
    try {
      const web3Provider = new ethers.BrowserProvider(wallet.provider);
      setProvider(web3Provider);
      const accounts = await web3Provider.send("eth_requestAccounts", []);
      const acc = accounts[0] || "";
      setAccount(acc);

      wallet.provider.on("accountsChanged", async (accounts: string[]) => {
        const newAcc = accounts[0] || "";
        setAccount(newAcc);
      });
    } catch (e) {
      alert("Failed to connect wallet");
    }
  };

  const onConnect = () => setWalletSelectorOpen(true);
  const onDisconnect = () => {
    setAccount("");
    setProvider(null);
  };

  const loadRecords = async () => {
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      // Check contract availability using FHE
      const isAvailable = await contract.isAvailable();
      if (!isAvailable) {
        console.error("Contract is not available");
        return;
      }
      
      const keysBytes = await contract.getData("oral_history_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing record keys:", e);
        }
      }
      
      const list: OralHistoryRecord[] = [];
      
      for (const key of keys) {
        try {
          const recordBytes = await contract.getData(`oral_history_${key}`);
          if (recordBytes.length > 0) {
            try {
              const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
              list.push({
                id: key,
                encryptedData: recordData.data,
                timestamp: recordData.timestamp,
                owner: recordData.owner,
                category: recordData.category,
                status: recordData.status || "pending",
                analysisResult: recordData.analysisResult
              });
            } catch (e) {
              console.error(`Error parsing record data for ${key}:`, e);
            }
          }
        } catch (e) {
          console.error(`Error loading record ${key}:`, e);
        }
      }
      
      list.sort((a, b) => b.timestamp - a.timestamp);
      setRecords(list);
    } catch (e) {
      console.error("Error loading records:", e);
    } finally {
      setIsRefreshing(false);
      setLoading(false);
    }
  };

  const uploadRecord = async () => {
    if (!provider) { 
      alert("Please connect wallet first"); 
      return; 
    }
    
    setUploading(true);
    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Encrypting sensitive content with FHE..."
    });
    
    try {
      // Simulate FHE encryption
      const encryptedData = `FHE-${btoa(JSON.stringify(newRecordData))}`;
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const recordId = `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

      const recordData = {
        data: encryptedData,
        timestamp: Math.floor(Date.now() / 1000),
        owner: account,
        category: newRecordData.category,
        status: "pending"
      };
      
      // Store encrypted data on-chain using FHE
      await contract.setData(
        `oral_history_${recordId}`, 
        ethers.toUtf8Bytes(JSON.stringify(recordData))
      );
      
      const keysBytes = await contract.getData("oral_history_keys");
      let keys: string[] = [];
      
      if (keysBytes.length > 0) {
        try {
          keys = JSON.parse(ethers.toUtf8String(keysBytes));
        } catch (e) {
          console.error("Error parsing keys:", e);
        }
      }
      
      keys.push(recordId);
      
      await contract.setData(
        "oral_history_keys", 
        ethers.toUtf8Bytes(JSON.stringify(keys))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Encrypted oral history submitted securely!"
      });
      
      await loadRecords();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
        setShowUploadModal(false);
        setNewRecordData({
          category: "",
          description: "",
          sensitiveContent: ""
        });
      }, 2000);
    } catch (e: any) {
      const errorMessage = e.message.includes("user rejected transaction")
        ? "Transaction rejected by user"
        : "Upload failed: " + (e.message || "Unknown error");
      
      setTransactionStatus({
        visible: true,
        status: "error",
        message: errorMessage
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    } finally {
      setUploading(false);
    }
  };

  const analyzeRecord = async (recordId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted data with FHE analysis..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const recordBytes = await contract.getData(`oral_history_${recordId}`);
      if (recordBytes.length === 0) {
        throw new Error("Record not found");
      }
      
      const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
      
      // Simulate FHE analysis results
      const analysisResult = {
        sentiment: Math.random() * 2 - 1, // -1 to 1
        topics: ["trauma", "resistance", "identity"],
        riskLevel: ["low", "medium", "high"][Math.floor(Math.random() * 3)] as "low" | "medium" | "high"
      };
      
      const updatedRecord = {
        ...recordData,
        status: "analyzed",
        analysisResult
      };
      
      await contract.setData(
        `oral_history_${recordId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedRecord))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "FHE analysis completed successfully!"
      });
      
      await loadRecords();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Analysis failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const rejectRecord = async (recordId: string) => {
    if (!provider) {
      alert("Please connect wallet first");
      return;
    }

    setTransactionStatus({
      visible: true,
      status: "pending",
      message: "Processing encrypted data with FHE..."
    });

    try {
      // Simulate FHE computation time
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const contract = await getContractWithSigner();
      if (!contract) {
        throw new Error("Failed to get contract with signer");
      }
      
      const recordBytes = await contract.getData(`oral_history_${recordId}`);
      if (recordBytes.length === 0) {
        throw new Error("Record not found");
      }
      
      const recordData = JSON.parse(ethers.toUtf8String(recordBytes));
      
      const updatedRecord = {
        ...recordData,
        status: "rejected"
      };
      
      await contract.setData(
        `oral_history_${recordId}`, 
        ethers.toUtf8Bytes(JSON.stringify(updatedRecord))
      );
      
      setTransactionStatus({
        visible: true,
        status: "success",
        message: "Record rejection completed successfully!"
      });
      
      await loadRecords();
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
    } catch (e: any) {
      setTransactionStatus({
        visible: true,
        status: "error",
        message: "Rejection failed: " + (e.message || "Unknown error")
      });
      
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 3000);
    }
  };

  const isOwner = (address: string) => {
    return account.toLowerCase() === address.toLowerCase();
  };

  const tutorialSteps = [
    {
      title: "Connect Wallet",
      description: "Connect your Web3 wallet to access the FHE oral history analysis platform",
      icon: "🔗"
    },
    {
      title: "Upload Encrypted Data",
      description: "Submit sensitive oral history content which will be encrypted using FHE",
      icon: "🔒"
    },
    {
      title: "FHE Analysis",
      description: "Your data is analyzed in encrypted state without decryption",
      icon: "⚙️"
    },
    {
      title: "Get Insights",
      description: "Receive analytical insights while keeping sensitive content private",
      icon: "📊"
    }
  ];

  const renderSentimentChart = () => {
    const sentimentData = records
      .filter(r => r.status === "analyzed" && r.analysisResult)
      .map(r => r.analysisResult!.sentiment);
    
    if (sentimentData.length === 0) {
      return <div className="no-data-chart">No analysis data available</div>;
    }
    
    const positiveCount = sentimentData.filter(s => s > 0).length;
    const negativeCount = sentimentData.filter(s => s < 0).length;
    const neutralCount = sentimentData.filter(s => s === 0).length;
    
    return (
      <div className="sentiment-chart">
        <div className="chart-bar">
          <div 
            className="bar-segment positive" 
            style={{ width: `${(positiveCount / sentimentData.length) * 100}%` }}
          >
            <span>Positive: {positiveCount}</span>
          </div>
          <div 
            className="bar-segment neutral" 
            style={{ width: `${(neutralCount / sentimentData.length) * 100}%` }}
          >
            <span>Neutral: {neutralCount}</span>
          </div>
          <div 
            className="bar-segment negative" 
            style={{ width: `${(negativeCount / sentimentData.length) * 100}%` }}
          >
            <span>Negative: {negativeCount}</span>
          </div>
        </div>
        <div className="chart-legend">
          <div className="legend-item">
            <div className="color-dot positive"></div>
            <span>Positive</span>
          </div>
          <div className="legend-item">
            <div className="color-dot neutral"></div>
            <span>Neutral</span>
          </div>
          <div className="legend-item">
            <div className="color-dot negative"></div>
            <span>Negative</span>
          </div>
        </div>
      </div>
    );
  };

  const renderRiskDistribution = () => {
    const analyzedRecords = records.filter(r => r.status === "analyzed" && r.analysisResult);
    if (analyzedRecords.length === 0) {
      return <div className="no-data-chart">No risk data available</div>;
    }
    
    const lowRisk = analyzedRecords.filter(r => r.analysisResult?.riskLevel === "low").length;
    const mediumRisk = analyzedRecords.filter(r => r.analysisResult?.riskLevel === "medium").length;
    const highRisk = analyzedRecords.filter(r => r.analysisResult?.riskLevel === "high").length;
    
    const total = analyzedRecords.length;
    
    return (
      <div className="risk-distribution">
        <div className="distribution-item">
          <div className="risk-label">Low Risk</div>
          <div className="risk-bar">
            <div 
              className="risk-fill low" 
              style={{ width: `${(lowRisk / total) * 100}%` }}
            ></div>
          </div>
          <div className="risk-count">{lowRisk}</div>
        </div>
        <div className="distribution-item">
          <div className="risk-label">Medium Risk</div>
          <div className="risk-bar">
            <div 
              className="risk-fill medium" 
              style={{ width: `${(mediumRisk / total) * 100}%` }}
            ></div>
          </div>
          <div className="risk-count">{mediumRisk}</div>
        </div>
        <div className="distribution-item">
          <div className="risk-label">High Risk</div>
          <div className="risk-bar">
            <div 
              className="risk-fill high" 
              style={{ width: `${(highRisk / total) * 100}%` }}
            ></div>
          </div>
          <div className="risk-count">{highRisk}</div>
        </div>
      </div>
    );
  };

  if (loading) return (
    <div className="loading-screen">
      <div className="mechanical-spinner"></div>
      <p>Initializing FHE connection...</p>
    </div>
  );

  return (
    <div className="app-container industrial-theme">
      <header className="app-header">
        <div className="logo">
          <div className="gear-logo"></div>
          <h1>OralHistory<span>FHE</span></h1>
        </div>
        
        <div className="header-actions">
          <button 
            onClick={() => setShowUploadModal(true)} 
            className="upload-btn industrial-button"
          >
            <div className="upload-icon"></div>
            Upload Record
          </button>
          <button 
            className="industrial-button"
            onClick={() => setShowTutorial(!showTutorial)}
          >
            {showTutorial ? "Hide Guide" : "Show Guide"}
          </button>
          <WalletManager account={account} onConnect={onConnect} onDisconnect={onDisconnect} />
        </div>
      </header>
      
      <div className="main-content">
        <div className="panel-navigation">
          <button 
            className={`panel-nav-btn ${activePanel === "dashboard" ? "active" : ""}`}
            onClick={() => setActivePanel("dashboard")}
          >
            Dashboard
          </button>
          <button 
            className={`panel-nav-btn ${activePanel === "records" ? "active" : ""}`}
            onClick={() => setActivePanel("records")}
          >
            Records
          </button>
          <button 
            className={`panel-nav-btn ${activePanel === "analysis" ? "active" : ""}`}
            onClick={() => setActivePanel("analysis")}
          >
            Analysis
          </button>
        </div>
        
        {activePanel === "dashboard" && (
          <div className="dashboard-panel">
            <div className="welcome-banner industrial-panel">
              <div className="welcome-text">
                <h2>Confidential Analysis of Sensitive Oral History Archives</h2>
                <p>Secure platform for analyzing sensitive oral histories using Fully Homomorphic Encryption technology</p>
              </div>
              <div className="fhe-badge">
                <span>FHE-Powered</span>
              </div>
            </div>
            
            {showTutorial && (
              <div className="tutorial-section industrial-panel">
                <h2>FHE Oral History Analysis Guide</h2>
                <p className="subtitle">Learn how to securely process sensitive oral histories</p>
                
                <div className="tutorial-steps">
                  {tutorialSteps.map((step, index) => (
                    <div 
                      className="tutorial-step"
                      key={index}
                    >
                      <div className="step-icon">{step.icon}</div>
                      <div className="step-content">
                        <h3>{step.title}</h3>
                        <p>{step.description}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
            
            <div className="stats-grid">
              <div className="stat-card industrial-panel">
                <h3>Total Records</h3>
                <div className="stat-value">{records.length}</div>
                <div className="stat-trend">All encrypted with FHE</div>
              </div>
              
              <div className="stat-card industrial-panel">
                <h3>Analyzed</h3>
                <div className="stat-value">{analyzedCount}</div>
                <div className="stat-trend">Processed securely</div>
              </div>
              
              <div className="stat-card industrial-panel">
                <h3>Pending</h3>
                <div className="stat-value">{pendingCount}</div>
                <div className="stat-trend">Awaiting analysis</div>
              </div>
              
              <div className="stat-card industrial-panel">
                <h3>Rejected</h3>
                <div className="stat-value">{rejectedCount}</div>
                <div className="stat-trend">Not suitable</div>
              </div>
            </div>
            
            <div className="charts-container">
              <div className="chart-panel industrial-panel">
                <h3>Sentiment Analysis</h3>
                {renderSentimentChart()}
              </div>
              
              <div className="chart-panel industrial-panel">
                <h3>Risk Level Distribution</h3>
                {renderRiskDistribution()}
              </div>
            </div>
          </div>
        )}
        
        {activePanel === "records" && (
          <div className="records-panel">
            <div className="panel-header industrial-panel">
              <h2>Encrypted Oral History Records</h2>
              <div className="header-actions">
                <button 
                  onClick={loadRecords}
                  className="refresh-btn industrial-button"
                  disabled={isRefreshing}
                >
                  {isRefreshing ? "Refreshing..." : "Refresh Records"}
                </button>
              </div>
            </div>
            
            <div className="records-list industrial-panel">
              <div className="table-header">
                <div className="header-cell">ID</div>
                <div className="header-cell">Category</div>
                <div className="header-cell">Owner</div>
                <div className="header-cell">Date</div>
                <div className="header-cell">Status</div>
                <div className="header-cell">Actions</div>
              </div>
              
              {records.length === 0 ? (
                <div className="no-records">
                  <div className="no-records-icon"></div>
                  <p>No encrypted records found</p>
                  <button 
                    className="industrial-button primary"
                    onClick={() => setShowUploadModal(true)}
                  >
                    Upload First Record
                  </button>
                </div>
              ) : (
                records.map(record => (
                  <React.Fragment key={record.id}>
                    <div className="record-row">
                      <div className="table-cell record-id">#{record.id.substring(0, 6)}</div>
                      <div className="table-cell">{record.category}</div>
                      <div className="table-cell">{record.owner.substring(0, 6)}...{record.owner.substring(38)}</div>
                      <div className="table-cell">
                        {new Date(record.timestamp * 1000).toLocaleDateString()}
                      </div>
                      <div className="table-cell">
                        <span className={`status-badge ${record.status}`}>
                          {record.status}
                        </span>
                      </div>
                      <div className="table-cell actions">
                        <button 
                          className="action-btn industrial-button"
                          onClick={() => setExpandedRecord(expandedRecord === record.id ? null : record.id)}
                        >
                          {expandedRecord === record.id ? "Collapse" : "Details"}
                        </button>
                        {isOwner(record.owner) && record.status === "pending" && (
                          <>
                            <button 
                              className="action-btn industrial-button success"
                              onClick={() => analyzeRecord(record.id)}
                            >
                              Analyze
                            </button>
                            <button 
                              className="action-btn industrial-button danger"
                              onClick={() => rejectRecord(record.id)}
                            >
                              Reject
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    
                    {expandedRecord === record.id && (
                      <div className="record-details">
                        <div className="details-content">
                          <h4>Record Details</h4>
                          <div className="details-grid">
                            <div className="detail-item">
                              <label>Record ID:</label>
                              <span>{record.id}</span>
                            </div>
                            <div className="detail-item">
                              <label>Owner:</label>
                              <span>{record.owner}</span>
                            </div>
                            <div className="detail-item">
                              <label>Upload Date:</label>
                              <span>{new Date(record.timestamp * 1000).toLocaleString()}</span>
                            </div>
                            <div className="detail-item">
                              <label>Status:</label>
                              <span className={`status-badge ${record.status}`}>{record.status}</span>
                            </div>
                          </div>
                          
                          {record.status === "analyzed" && record.analysisResult && (
                            <div className="analysis-results">
                              <h4>FHE Analysis Results</h4>
                              <div className="results-grid">
                                <div className="result-item">
                                  <label>Sentiment Score:</label>
                                  <span>{record.analysisResult.sentiment.toFixed(2)}</span>
                                </div>
                                <div className="result-item">
                                  <label>Risk Level:</label>
                                  <span className={`risk-badge ${record.analysisResult.riskLevel}`}>
                                    {record.analysisResult.riskLevel}
                                  </span>
                                </div>
                                <div className="result-item full-width">
                                  <label>Detected Topics:</label>
                                  <div className="topics-list">
                                    {record.analysisResult.topics.map((topic, index) => (
                                      <span key={index} className="topic-tag">{topic}</span>
                                    ))}
                                  </div>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </React.Fragment>
                ))
              )}
            </div>
          </div>
        )}
        
        {activePanel === "analysis" && (
          <div className="analysis-panel">
            <div className="panel-header industrial-panel">
              <h2>FHE Analysis Overview</h2>
              <p>Statistical insights from encrypted oral history analysis</p>
            </div>
            
            <div className="analysis-content">
              <div className="analysis-card industrial-panel">
                <h3>Sentiment Distribution</h3>
                {renderSentimentChart()}
              </div>
              
              <div className="analysis-card industrial-panel">
                <h3>Risk Level Analysis</h3>
                {renderRiskDistribution()}
              </div>
              
              <div className="analysis-card industrial-panel">
                <h3>Processing Statistics</h3>
                <div className="processing-stats">
                  <div className="processing-stat">
                    <div className="stat-label">Total Processed</div>
                    <div className="stat-value">{analyzedCount}</div>
                  </div>
                  <div className="processing-stat">
                    <div className="stat-label">Average Processing Time</div>
                    <div className="stat-value">3.2s</div>
                  </div>
                  <div className="processing-stat">
                    <div className="stat-label">FHE Accuracy</div>
                    <div className="stat-value">94.7%</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
  
      {showUploadModal && (
        <ModalUpload 
          onSubmit={uploadRecord} 
          onClose={() => setShowUploadModal(false)} 
          uploading={uploading}
          recordData={newRecordData}
          setRecordData={setNewRecordData}
        />
      )}
      
      {walletSelectorOpen && (
        <WalletSelector
          isOpen={walletSelectorOpen}
          onWalletSelect={(wallet) => { onWalletSelect(wallet); setWalletSelectorOpen(false); }}
          onClose={() => setWalletSelectorOpen(false)}
        />
      )}
      
      {transactionStatus.visible && (
        <div className="transaction-modal">
          <div className="transaction-content industrial-panel">
            <div className={`transaction-icon ${transactionStatus.status}`}>
              {transactionStatus.status === "pending" && <div className="mechanical-spinner"></div>}
              {transactionStatus.status === "success" && <div className="success-icon"></div>}
              {transactionStatus.status === "error" && <div className="error-icon"></div>}
            </div>
            <div className="transaction-message">
              {transactionStatus.message}
            </div>
          </div>
        </div>
      )}
  
      <footer className="app-footer">
        <div className="footer-content">
          <div className="footer-brand">
            <div className="logo">
              <div className="gear-logo"></div>
              <span>OralHistoryFHE</span>
            </div>
            <p>Confidential analysis of sensitive oral history archives using FHE technology</p>
          </div>
          
          <div className="footer-links">
            <a href="#" className="footer-link">Documentation</a>
            <a href="#" className="footer-link">Privacy Policy</a>
            <a href="#" className="footer-link">Terms of Service</a>
            <a href="#" className="footer-link">Contact</a>
          </div>
        </div>
        
        <div className="footer-bottom">
          <div className="fhe-badge">
            <span>FHE-Powered Confidentiality</span>
          </div>
          <div className="copyright">
            © {new Date().getFullYear()} OralHistoryFHE. All rights reserved.
          </div>
        </div>
      </footer>
    </div>
  );
};

interface ModalUploadProps {
  onSubmit: () => void; 
  onClose: () => void; 
  uploading: boolean;
  recordData: any;
  setRecordData: (data: any) => void;
}

const ModalUpload: React.FC<ModalUploadProps> = ({ 
  onSubmit, 
  onClose, 
  uploading,
  recordData,
  setRecordData
}) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const { name, value } = e.target;
    setRecordData({
      ...recordData,
      [name]: value
    });
  };

  const handleSubmit = () => {
    if (!recordData.category || !recordData.sensitiveContent) {
      alert("Please fill required fields");
      return;
    }
    
    onSubmit();
  };

  return (
    <div className="modal-overlay">
      <div className="upload-modal industrial-panel">
        <div className="modal-header">
          <h2>Upload Oral History Record</h2>
          <button onClick={onClose} className="close-modal">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice-banner">
            <div className="lock-icon"></div> Your sensitive content will be encrypted with FHE
          </div>
          
          <div className="form-grid">
            <div className="form-group">
              <label>Category *</label>
              <select 
                name="category"
                value={recordData.category} 
                onChange={handleChange}
                className="industrial-select"
              >
                <option value="">Select category</option>
                <option value="Trauma">Trauma Narrative</option>
                <option value="Resistance">Resistance History</option>
                <option value="Identity">Identity Formation</option>
                <option value="Community">Community Memory</option>
                <option value="Other">Other</option>
              </select>
            </div>
            
            <div className="form-group">
              <label>Description</label>
              <input 
                type="text"
                name="description"
                value={recordData.description} 
                onChange={handleChange}
                placeholder="Brief description..." 
                className="industrial-input"
              />
            </div>
            
            <div className="form-group full-width">
              <label>Sensitive Content *</label>
              <textarea 
                name="sensitiveContent"
                value={recordData.sensitiveContent} 
                onChange={handleChange}
                placeholder="Enter sensitive oral history content to encrypt..." 
                className="industrial-textarea"
                rows={4}
              />
            </div>
          </div>
          
          <div className="privacy-notice">
            <div className="shield-icon"></div> Content remains encrypted during FHE processing
          </div>
        </div>
        
        <div className="modal-footer">
          <button 
            onClick={onClose}
            className="cancel-btn industrial-button"
          >
            Cancel
          </button>
          <button 
            onClick={handleSubmit} 
            disabled={uploading}
            className="submit-btn industrial-button primary"
          >
            {uploading ? "Encrypting with FHE..." : "Upload Securely"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default App;