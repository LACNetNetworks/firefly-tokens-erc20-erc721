// SPDX-License-Identifier: MIT
// OpenZeppelin Contracts v4.4.1 (utils/Context.sol)

pragma solidity ^0.8.0;

/**
 * @dev Provides information about the current execution context, including the
 * sender of the transaction and its data. While these are generally available
 * via msg.sender and msg.data, they should not be accessed in such a direct
 * manner, since when dealing with meta-transactions the account sending and
 * paying for execution may not be the actual sender (as far as an application
 * is concerned).
 *
 * This contract is only required for intermediate, library-like contracts.
 */
abstract contract Context {

    //address internal trustedForwarder = 0xEAA5420AF59305c5ecacCB38fcDe70198001d147;  //mainnet 
    address internal trustedForwarder = 0x5817a7Efbda3D203a48E58DEBB1484ACbb42EEbf;  //david19
    //address internal trustedForwarder = 0x43B6A574C5606A894F81d0CBeA087F0260Eb822d;   //testnet

    function _msgSender() internal virtual returns (address) {
        bytes memory bytesRelayHub;
        (,bytesRelayHub) = trustedForwarder.call(abi.encodeWithSignature("getRelayHub()"));

        if (msg.sender == abi.decode(bytesRelayHub, (address))){ //sender is RelayHub then return origin sender
            bytes memory bytesSender;
            (,bytesSender) = trustedForwarder.call(abi.encodeWithSignature("getMsgSender()"));
        
            return abi.decode(bytesSender, (address));
        } else { //sender is not RelayHub, so it is another smart contract 
            return msg.sender;
        }
    }

    function _msgData() internal view virtual returns (bytes calldata) {
        return msg.data;
    }
}
