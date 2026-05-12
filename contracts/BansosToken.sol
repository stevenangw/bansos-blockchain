// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/// @title BansosToken
/// @notice Token pintar untuk distribusi bantuan sosial digital
/// @dev Menerapkan kontrol akses admin dan whitelist penerima
contract BansosToken {
    /// @notice Nama token
    string public name = "Bansos Digital";
    
    /// @notice Simbol token
    string public symbol = "BANSOS";
    
    /// @notice Desimal token (0 karena bansos tidak bisa dipecah)
    uint8 public constant decimals = 0;
    
    /// @dev Total suplai token
    uint256 private _totalSupply;

    /// @dev Mapping saldo setiap alamat
    mapping(address => uint256) private _balances;
    
    /// @dev Mapping allowance
    mapping(address => mapping(address => uint256)) private _allowances;
    
    /// @notice Mapping status whitelist (hanya yang masuk whitelist yang bisa terima token)
    mapping(address => bool) public whitelist;
    
    /// @notice Alamat admin kontrak
    address public admin;

    /// @notice Event yang dipancarkan saat transfer token terjadi
    event Transfer(address indexed from, address indexed to, uint256 value);
    
    /// @notice Event yang dipancarkan saat persetujuan (approval) terjadi
    event Approval(address indexed owner, address indexed spender, uint256 value);
    
    /// @notice Event yang dipancarkan saat status whitelist diubah
    event WhitelistUpdated(address indexed account, bool status);

    /// @dev Modifier untuk membatasi akses hanya untuk admin
    modifier onlyAdmin() {
        require(msg.sender == admin, "Hanya admin");
        _;
    }

    /// @notice Konstruktor mengatur deployer sebagai admin
    constructor() {
        admin = msg.sender;
    }

    /// @notice Mengembalikan total suplai token saat ini
    /// @return Jumlah total token yang beredar
    function totalSupply() public view returns (uint256) {
        return _totalSupply;
    }

    /// @notice Mengecek saldo token dari suatu alamat
    /// @param account Alamat yang akan dicek
    /// @return Saldo token
    function balanceOf(address account) public view returns (uint256) {
        return _balances[account];
    }

    /// @notice Mentransfer token ke alamat tujuan
    /// @param to Alamat penerima
    /// @param amount Jumlah token
    /// @return bool Status keberhasilan transfer
    function transfer(address to, uint256 amount) public returns (bool) {
        require(amount > 0, "Jumlah transfer harus lebih dari 0");
        require(whitelist[to], "Penerima tidak terdaftar di whitelist");
        _transfer(msg.sender, to, amount);
        return true;
    }

    /// @notice Memberikan persetujuan kepada entitas lain untuk mentransfer token
    /// @param spender Alamat yang diberikan persetujuan
    /// @param amount Jumlah batas token
    /// @return bool Status keberhasilan
    function approve(address spender, uint256 amount) public returns (bool) {
        require(spender != address(0), "Approve ke alamat nol");
        _allowances[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    /// @notice Mengecek jatah token yang disetujui
    /// @param owner Pemilik token
    /// @param spender Pihak yang disetujui
    /// @return Sisa jatah transfer
    function allowance(address owner, address spender) public view returns (uint256) {
        return _allowances[owner][spender];
    }

    /// @notice Mentransfer token dari suatu alamat ke alamat lain berdasarkan allowance
    /// @param from Alamat pengirim
    /// @param to Alamat penerima
    /// @param amount Jumlah token
    /// @return bool Status keberhasilan
    function transferFrom(address from, address to, uint256 amount) public returns (bool) {
        require(amount > 0, "Jumlah transfer harus lebih dari 0");
        require(whitelist[to], "Penerima tidak terdaftar di whitelist");
        require(_allowances[from][msg.sender] >= amount, "Allowance tidak mencukupi");
        
        _allowances[from][msg.sender] -= amount;
        _transfer(from, to, amount);
        return true;
    }

    /// @notice Mencetak (mint) token baru ke alamat tertentu (Hanya Admin)
    /// @param to Alamat penerima token baru
    /// @param amount Jumlah token yang dicetak
    function mint(address to, uint256 amount) public onlyAdmin {
        require(amount > 0, "Jumlah mint harus lebih dari 0");
        require(to != address(0), "Mint ke alamat nol");
        require(whitelist[to], "Penerima tidak terdaftar di whitelist");
        
        _totalSupply += amount;
        _balances[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    /// @notice Mengatur status whitelist suatu alamat (Hanya Admin)
    /// @param account Alamat yang akan diatur
    /// @param status Status whitelist (true/false)
    function setWhitelist(address account, bool status) public onlyAdmin {
        require(account != address(0), "Alamat nol tidak valid");
        whitelist[account] = status;
        emit WhitelistUpdated(account, status);
    }

    /// @dev Fungsi internal untuk logika dasar transfer
    /// @param from Alamat asal
    /// @param to Alamat tujuan
    /// @param amount Jumlah token
    function _transfer(address from, address to, uint256 amount) internal {
        require(from != address(0), "Transfer dari alamat nol");
        require(to != address(0), "Transfer ke alamat nol");
        require(_balances[from] >= amount, "Saldo tidak cukup");
        
        _balances[from] -= amount;
        _balances[to] += amount;
        emit Transfer(from, to, amount);
    }
}