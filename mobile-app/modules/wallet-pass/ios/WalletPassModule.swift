import ExpoModulesCore
import PassKit

public class WalletPassModule: Module {
  public func definition() -> ModuleDefinition {
    Name("WalletPass")

    // False where Wallet is unavailable (some iPads, restricted devices).
    Function("canAddPasses") { () -> Bool in
      PKAddPassesViewController.canAddPasses()
    }

    // Downloads the signed .pkpass at `url` and shows Apple's own add-to-Wallet sheet over the app.
    // Resolves once the sheet is on screen.
    AsyncFunction("addPassFromUrl") { (url: URL, promise: Promise) in
      URLSession.shared.dataTask(with: url) { [weak self] data, response, error in
        if let error {
          promise.reject("ERR_WALLET_DOWNLOAD", error.localizedDescription)
          return
        }
        guard let status = (response as? HTTPURLResponse)?.statusCode, status == 200, let data else {
          promise.reject("ERR_WALLET_DOWNLOAD", "The pass could not be downloaded")
          return
        }
        let pass: PKPass
        do {
          pass = try PKPass(data: data)
        } catch {
          promise.reject("ERR_WALLET_PASS", "The pass is not valid: \(error.localizedDescription)")
          return
        }
        DispatchQueue.main.async {
          guard
            let sheet = PKAddPassesViewController(pass: pass),
            let presenter = self?.appContext?.utilities?.currentViewController()
          else {
            promise.reject("ERR_WALLET_UNAVAILABLE", "Wallet is not available")
            return
          }
          presenter.present(sheet, animated: true) { promise.resolve(nil) }
        }
      }.resume()
    }

    View(WalletPassView.self) {
      // "black" on light backgrounds, "blackOutline" on dark ones.
      Prop("variant") { (view: WalletPassView, variant: String?) in
        view.button.addPassButtonStyle = variant == "black" ? .black : .blackOutline
      }
      Events("onAddPass")
    }
  }
}
