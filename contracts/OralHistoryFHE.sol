// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { FHE, euint32, ebool } from "@fhevm/solidity/lib/FHE.sol";
import { SepoliaConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract OralHistoryFHE is SepoliaConfig {
    struct EncryptedRecording {
        uint256 id;
        euint32 encryptedTranscript;
        euint32 encryptedMetadata;
        euint32 encryptedIntervieweeId;
        uint256 timestamp;
    }
    
    struct DecryptedRecording {
        string transcript;
        string metadata;
        string intervieweeId;
        bool isAnalyzed;
    }

    uint256 public recordingCount;
    mapping(uint256 => EncryptedRecording) public encryptedRecordings;
    mapping(uint256 => DecryptedRecording) public decryptedRecordings;
    
    mapping(string => euint32) private encryptedIntervieweeStats;
    string[] private intervieweeList;
    
    mapping(uint256 => uint256) private requestToRecordingId;
    
    event RecordingSubmitted(uint256 indexed id, uint256 timestamp);
    event AnalysisRequested(uint256 indexed id);
    event RecordingAnalyzed(uint256 indexed id);
    
    modifier onlyResearcher(uint256 recordingId) {
        _;
    }
    
    function submitEncryptedRecording(
        euint32 encryptedTranscript,
        euint32 encryptedMetadata,
        euint32 encryptedIntervieweeId
    ) public {
        recordingCount += 1;
        uint256 newId = recordingCount;
        
        encryptedRecordings[newId] = EncryptedRecording({
            id: newId,
            encryptedTranscript: encryptedTranscript,
            encryptedMetadata: encryptedMetadata,
            encryptedIntervieweeId: encryptedIntervieweeId,
            timestamp: block.timestamp
        });
        
        decryptedRecordings[newId] = DecryptedRecording({
            transcript: "",
            metadata: "",
            intervieweeId: "",
            isAnalyzed: false
        });
        
        emit RecordingSubmitted(newId, block.timestamp);
    }
    
    function requestContentAnalysis(uint256 recordingId) public onlyResearcher(recordingId) {
        EncryptedRecording storage rec = encryptedRecordings[recordingId];
        require(!decryptedRecordings[recordingId].isAnalyzed, "Already analyzed");
        
        bytes32[] memory ciphertexts = new bytes32[](3);
        ciphertexts[0] = FHE.toBytes32(rec.encryptedTranscript);
        ciphertexts[1] = FHE.toBytes32(rec.encryptedMetadata);
        ciphertexts[2] = FHE.toBytes32(rec.encryptedIntervieweeId);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.analyzeContent.selector);
        requestToRecordingId[reqId] = recordingId;
        
        emit AnalysisRequested(recordingId);
    }
    
    function analyzeContent(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 recordingId = requestToRecordingId[requestId];
        require(recordingId != 0, "Invalid request");
        
        EncryptedRecording storage eRec = encryptedRecordings[recordingId];
        DecryptedRecording storage dRec = decryptedRecordings[recordingId];
        require(!dRec.isAnalyzed, "Already analyzed");
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        (string memory transcript, string memory metadata, string memory intervieweeId) = 
            abi.decode(cleartexts, (string, string, string));
        
        dRec.transcript = transcript;
        dRec.metadata = metadata;
        dRec.intervieweeId = intervieweeId;
        dRec.isAnalyzed = true;
        
        if (FHE.isInitialized(encryptedIntervieweeStats[dRec.intervieweeId]) == false) {
            encryptedIntervieweeStats[dRec.intervieweeId] = FHE.asEuint32(0);
            intervieweeList.push(dRec.intervieweeId);
        }
        encryptedIntervieweeStats[dRec.intervieweeId] = FHE.add(
            encryptedIntervieweeStats[dRec.intervieweeId], 
            FHE.asEuint32(1)
        );
        
        emit RecordingAnalyzed(recordingId);
    }
    
    function getDecryptedRecording(uint256 recordingId) public view returns (
        string memory transcript,
        string memory metadata,
        string memory intervieweeId,
        bool isAnalyzed
    ) {
        DecryptedRecording storage r = decryptedRecordings[recordingId];
        return (r.transcript, r.metadata, r.intervieweeId, r.isAnalyzed);
    }
    
    function getEncryptedIntervieweeStats(string memory intervieweeId) public view returns (euint32) {
        return encryptedIntervieweeStats[intervieweeId];
    }
    
    function requestIntervieweeStatsDecryption(string memory intervieweeId) public {
        euint32 stats = encryptedIntervieweeStats[intervieweeId];
        require(FHE.isInitialized(stats), "Interviewee not found");
        
        bytes32[] memory ciphertexts = new bytes32[](1);
        ciphertexts[0] = FHE.toBytes32(stats);
        
        uint256 reqId = FHE.requestDecryption(ciphertexts, this.decryptIntervieweeStats.selector);
        requestToRecordingId[reqId] = bytes32ToUint(keccak256(abi.encodePacked(intervieweeId)));
    }
    
    function decryptIntervieweeStats(
        uint256 requestId,
        bytes memory cleartexts,
        bytes memory proof
    ) public {
        uint256 intervieweeHash = requestToRecordingId[requestId];
        string memory intervieweeId = getIntervieweeFromHash(intervieweeHash);
        
        FHE.checkSignatures(requestId, cleartexts, proof);
        
        uint32 stats = abi.decode(cleartexts, (uint32));
    }
    
    function bytes32ToUint(bytes32 b) private pure returns (uint256) {
        return uint256(b);
    }
    
    function getIntervieweeFromHash(uint256 hash) private view returns (string memory) {
        for (uint i = 0; i < intervieweeList.length; i++) {
            if (bytes32ToUint(keccak256(abi.encodePacked(intervieweeList[i]))) == hash) {
                return intervieweeList[i];
            }
        }
        revert("Interviewee not found");
    }
    
    function analyzeEmotionalContent(
        uint256 recordingId,
        string[] memory emotionalMarkers
    ) public view returns (string[] memory detectedMarkers) {
        DecryptedRecording storage rec = decryptedRecordings[recordingId];
        require(rec.isAnalyzed, "Recording not analyzed");
        
        uint256 count = 0;
        for (uint256 i = 0; i < emotionalMarkers.length; i++) {
            if (containsMarker(rec.transcript, emotionalMarkers[i])) {
                count++;
            }
        }
        
        detectedMarkers = new string[](count);
        uint256 index = 0;
        for (uint256 i = 0; i < emotionalMarkers.length; i++) {
            if (containsMarker(rec.transcript, emotionalMarkers[i])) {
                detectedMarkers[index] = emotionalMarkers[i];
                index++;
            }
        }
        return detectedMarkers;
    }
    
    function containsMarker(
        string memory transcript,
        string memory marker
    ) private pure returns (bool) {
        // Simplified marker detection
        // In real implementation, this would use NLP techniques
        return keccak256(abi.encodePacked(transcript)) == keccak256(abi.encodePacked(marker));
    }
    
    function identifySensitiveTopics(
        uint256 recordingId,
        string[] memory sensitiveKeywords
    ) public view returns (string[] memory foundTopics) {
        DecryptedRecording storage rec = decryptedRecordings[recordingId];
        require(rec.isAnalyzed, "Recording not analyzed");
        
        uint256 count = 0;
        for (uint256 i = 0; i < sensitiveKeywords.length; i++) {
            if (containsKeyword(rec.transcript, sensitiveKeywords[i])) {
                count++;
            }
        }
        
        foundTopics = new string[](count);
        uint256 index = 0;
        for (uint256 i = 0; i < sensitiveKeywords.length; i++) {
            if (containsKeyword(rec.transcript, sensitiveKeywords[i])) {
                foundTopics[index] = sensitiveKeywords[i];
                index++;
            }
        }
        return foundTopics;
    }
    
    function containsKeyword(
        string memory transcript,
        string memory keyword
    ) private pure returns (bool) {
        // Simplified keyword detection
        return keccak256(abi.encodePacked(transcript)) == keccak256(abi.encodePacked(keyword));
    }
    
    function calculateNarrativePatterns(
        string memory intervieweeId
    ) public view returns (string[] memory patterns) {
        uint256 count = 0;
        for (uint256 i = 1; i <= recordingCount; i++) {
            if (decryptedRecordings[i].isAnalyzed && 
                keccak256(abi.encodePacked(decryptedRecordings[i].intervieweeId)) == keccak256(abi.encodePacked(intervieweeId))) {
                count++;
            }
        }
        
        patterns = new string[](count);
        uint256 index = 0;
        for (uint256 i = 1; i <= recordingCount; i++) {
            if (decryptedRecordings[i].isAnalyzed && 
                keccak256(abi.encodePacked(decryptedRecordings[i].intervieweeId)) == keccak256(abi.encodePacked(intervieweeId))) {
                patterns[index] = extractPattern(decryptedRecordings[i].transcript);
                index++;
            }
        }
        return patterns;
    }
    
    function extractPattern(
        string memory transcript
    ) private pure returns (string memory) {
        // Simplified pattern extraction
        return "NarrativePattern";
    }
    
    function generateAnonymizedExcerpts(
        uint256 recordingId,
        uint256 excerptLength
    ) public view returns (string[] memory excerpts) {
        DecryptedRecording storage rec = decryptedRecordings[recordingId];
        require(rec.isAnalyzed, "Recording not analyzed");
        
        // Simplified excerpt generation
        // In real implementation, this would properly anonymize content
        excerpts = new string[](1);
        excerpts[0] = rec.transcript;
        return excerpts;
    }
    
    function applyEthicalRedactions(
        uint256 recordingId,
        string[] memory sensitiveTerms
    ) public view returns (string memory redactedTranscript) {
        DecryptedRecording storage rec = decryptedRecordings[recordingId];
        require(rec.isAnalyzed, "Recording not analyzed");
        
        // Simplified redaction
        // In real implementation, this would properly redact sensitive terms
        return rec.transcript;
    }
}