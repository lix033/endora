# Cask Homebrew d'Endora — généré par scripts/render-packaging.mjs à chaque release.
cask "endora" do
  arch arm: "arm64", intel: "x64"

  version "{{VERSION}}"
  sha256 arm:   "{{SHA_MAC_ARM64}}",
         intel: "{{SHA_MAC_X64}}"

  url "https://github.com/lix033/endora/releases/download/v#{version}/Endora-#{version}-mac-#{arch}.dmg"
  name "Endora"
  desc "Client API de bureau open source"
  homepage "https://github.com/lix033/endora"

  livecheck do
    url :url
    strategy :github_latest
  end

  depends_on macos: ">= :big_sur"

  app "Endora.app"

  zap trash: [
    "~/Library/Application Support/Endora",
    "~/Library/Application Support/endora",
    "~/Library/Preferences/io.github.lix033.endora.plist",
    "~/Library/Saved Application State/io.github.lix033.endora.savedState",
  ]
end
