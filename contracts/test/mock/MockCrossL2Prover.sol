// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

import {ICrossL2ProverV2} from "../../src/interfaces/ICrossL2ProverV2.sol";

contract MockCrossL2Prover is ICrossL2ProverV2 {
    struct ValidateEventResult {
        uint32 chainId;
        address emittingContract;
        bytes topics;
        bytes unindexedData;
    }
    
    ValidateEventResult public validateEventResult;
    bool public returnValidData;

    function setValidateEventReturn(
        uint32 _chainId, 
        address _emittingContract, 
        bytes memory _topics, 
        bytes memory _unindexedData,
        bool _returnValidData
    ) external {
        validateEventResult.chainId = _chainId;
        validateEventResult.emittingContract = _emittingContract;
        validateEventResult.topics = _topics;
        validateEventResult.unindexedData = _unindexedData;
        returnValidData = _returnValidData;
    }

    function validateEvent(bytes calldata)
        external
        view
        returns (uint32, address, bytes memory, bytes memory) {
        require(returnValidData, "Mock configured to return invalid data");
        return (
            validateEventResult.chainId,
            validateEventResult.emittingContract,
            validateEventResult.topics,
            validateEventResult.unindexedData
        );
    }

    function inspectLogIdentifier(bytes calldata)
        external
        pure
        returns (uint32, uint64, uint16, uint8) {
        return (1, 1, 1, 1);
    }

    function inspectPolymerState(bytes calldata)
        external
        pure
        returns (bytes32, uint64, bytes memory) {
        return (bytes32(0), 0, bytes(""));
    }
} 