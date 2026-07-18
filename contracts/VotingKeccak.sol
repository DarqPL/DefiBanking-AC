// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract VotingKeccak {
    address public immutable owner;

    struct Candidate {
        string name;
        uint voteCount;
    }

    mapping(bytes32 => Candidate) public candidates;
    mapping(bytes32 => bool) public candidateExists;
    bytes32[] public candidateIds;

    mapping(address => bool) public hasVoted;

    event Voted(address indexed voter, bytes32 candidateId);
    event CandidateAdded(bytes32 candidateId, string name);

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
        bytes32 id = keccak256(abi.encodePacked(_name));
        if (candidateExists[id]) return;

        candidates[id] = Candidate({ name: _name, voteCount: 0 });
        candidateIds.push(id);
        candidateExists[id] = true;

        emit CandidateAdded(id, _name);
    }

    function vote(bytes32 _candidateId) external {
        if (hasVoted[msg.sender]) revert AlreadyVoted();
        if (!candidateExists[_candidateId]) revert InvalidCandidate();

        hasVoted[msg.sender] = true;
        candidates[_candidateId].voteCount++;

        emit Voted(msg.sender, _candidateId);
    }

    function getCandidateIds() external view returns (bytes32[] memory) {
        return candidateIds;
    }

    function getCandidatesCount() external view returns (uint) {
        return candidateIds.length;
    }
}
