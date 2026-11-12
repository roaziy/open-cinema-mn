import ExpoModulesCore
import PassKit

// Apple's own "Add to Apple Wallet" button (PKAddPassButton): iOS draws the official artwork,
// localized, so the app never ships or redraws it.
class WalletPassView: ExpoView {
  let button = PKAddPassButton(addPassButtonStyle: .blackOutline)
  let onAddPass = EventDispatcher()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    button.addTarget(self, action: #selector(pressed), for: .touchUpInside)
    addSubview(button)
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    button.frame = bounds
  }

  @objc private func pressed() {
    onAddPass()
  }
}
