const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("BansosToken", function () {
  let BansosToken, token;
  let admin, sender, receiver, unwhitelisted;

  beforeEach(async function () {
    [admin, sender, receiver, unwhitelisted] = await ethers.getSigners();

    const BansosTokenFactory = await ethers.getContractFactory("BansosToken");
    token = await BansosTokenFactory.deploy();
    await token.waitForDeployment();
  });

  describe("Deployment", function () {
    it("Harus menetapkan admin yang benar", async function () {
      expect(await token.admin()).to.equal(admin.address);
    });

    it("Harus memiliki nama dan simbol yang benar", async function () {
      expect(await token.name()).to.equal("Bansos Digital");
      expect(await token.symbol()).to.equal("BANSOS");
      expect(await token.decimals()).to.equal(0);
    });
  });

  describe("Whitelisting & Minting", function () {
    it("Admin dapat menambahkan ke whitelist", async function () {
      await expect(token.setWhitelist(sender.address, true))
        .to.emit(token, "WhitelistUpdated")
        .withArgs(sender.address, true);

      expect(await token.whitelist(sender.address)).to.be.true;
    });

    it("Bukan admin tidak dapat menambahkan ke whitelist", async function () {
      await expect(
        token.connect(sender).setWhitelist(receiver.address, true)
      ).to.be.revertedWith("Hanya admin");
    });

    it("Admin dapat melakukan minting ke akun yang terdaftar di whitelist", async function () {
      await token.setWhitelist(sender.address, true);

      await expect(token.mint(sender.address, 1000))
        .to.emit(token, "Transfer")
        .withArgs(ethers.ZeroAddress, sender.address, 1000);

      expect(await token.balanceOf(sender.address)).to.equal(1000);
      expect(await token.totalSupply()).to.equal(1000);
    });

    it("Gagal minting jika akun tidak ada di whitelist", async function () {
      await expect(token.mint(unwhitelisted.address, 1000)).to.be.revertedWith(
        "Penerima tidak terdaftar di whitelist"
      );
    });

    it("Bukan admin tidak dapat melakukan minting", async function () {
      await token.setWhitelist(sender.address, true);
      await expect(
        token.connect(sender).mint(sender.address, 1000)
      ).to.be.revertedWith("Hanya admin");
    });
  });

  describe("Transactions", function () {
    beforeEach(async function () {
      // Setup whitelist & saldo awal
      await token.setWhitelist(sender.address, true);
      await token.setWhitelist(receiver.address, true);
      await token.mint(sender.address, 5000);
    });

    it("Berhasil transfer token antar akun whitelist", async function () {
      await expect(token.connect(sender).transfer(receiver.address, 1000))
        .to.emit(token, "Transfer")
        .withArgs(sender.address, receiver.address, 1000);

      expect(await token.balanceOf(sender.address)).to.equal(4000);
      expect(await token.balanceOf(receiver.address)).to.equal(1000);
    });

    it("Gagal transfer ke akun non-whitelist", async function () {
      await expect(
        token.connect(sender).transfer(unwhitelisted.address, 1000)
      ).to.be.revertedWith("Penerima tidak terdaftar di whitelist");
    });

    it("Gagal transfer jika saldo tidak mencukupi", async function () {
      await expect(
        token.connect(sender).transfer(receiver.address, 10000)
      ).to.be.revertedWith("Saldo tidak cukup");
    });

    it("Berhasil melakukan approve dan transferFrom", async function () {
      // Sender approve Receiver untuk membelanjakan 500
      await expect(token.connect(sender).approve(receiver.address, 500))
        .to.emit(token, "Approval")
        .withArgs(sender.address, receiver.address, 500);

      expect(await token.allowance(sender.address, receiver.address)).to.equal(
        500
      );

      // Receiver menggunakan allowance
      await expect(
        token
          .connect(receiver)
          .transferFrom(sender.address, receiver.address, 500)
      )
        .to.emit(token, "Transfer")
        .withArgs(sender.address, receiver.address, 500);

      expect(await token.balanceOf(sender.address)).to.equal(4500);
      expect(await token.balanceOf(receiver.address)).to.equal(500);
      expect(await token.allowance(sender.address, receiver.address)).to.equal(
        0
      );
    });

    it("Gagal transferFrom jika melebihi allowance", async function () {
      await token.connect(sender).approve(receiver.address, 500);

      await expect(
        token
          .connect(receiver)
          .transferFrom(sender.address, receiver.address, 1000)
      ).to.be.revertedWith("Allowance tidak mencukupi");
    });
  });
});
