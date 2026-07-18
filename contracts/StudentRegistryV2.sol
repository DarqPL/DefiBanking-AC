// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;
contract StudentRegistryV2 {
    address public immutable owner;

    struct Student {
        string name;
        uint age;
        bool isRegistered;
    }
    
    mapping(address => Student) private students;

    event StudentAdded(address indexed studentAddress, string name, uint age);

    error Unauthorized();
    error AlreadyRegistered();

    constructor() {
        owner = msg.sender;
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert Unauthorized();
        _;
    }

    function registerStudent(address _student, string calldata _name, uint _age) external onlyOwner {
        if (students[_student].isRegistered) {
            revert AlreadyRegistered();
        }

        students[_student] = Student({
            name: _name,
            age: _age,
            isRegistered: true
        });

        emit StudentAdded(_student, _name, _age);
    }

    function getStudent(address _student) external view returns (string memory name, uint age, bool isRegistered) {
        Student storage s = students[_student];
        return (s.name, s.age, s.isRegistered);
    }

    function isStudentRegistered(address _student) external view returns (bool) {
        return students[_student].isRegistered;
    }
}