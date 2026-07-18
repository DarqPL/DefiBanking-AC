// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract Voting {
    address public immutable owner;
    
    struct Candidate {
        string name;
        uint voteCount;
    }
    
    mapping(uint => Candidate) public candidates;
    uint public candidatesCount;
    
    mapping(address => bool) public hasVoted;
    
    event Voted(address indexed voter, uint candidateId);
    event CandidateAdded(uint candidateId, string name);
    
    error Unauthorized();
    error AlreadyVoted();
    error InvalidCandidate();

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function addCandidate(string calldata _name) external onlyOwner {
        candidates[candidatesCount] = Candidate({
            name: _name,
            voteCount: 0
        });
        emit CandidateAdded(candidatesCount, _name);
        candidatesCount++;
    }

    function vote(uint _candidateId) external {
        if (hasVoted[msg.sender]) revert AlreadyVoted();
        
        if (_candidateId >= candidatesCount) revert InvalidCandidate();
        
        hasVoted[msg.sender] = true;
        
        candidates[_candidateId].voteCount++;
        
        emit Voted(msg.sender, _candidateId);
    }
}