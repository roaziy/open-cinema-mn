Pod::Spec.new do |s|
  s.name           = 'WalletPass'
  s.version        = '1.0.0'
  s.summary        = "Apple's Add to Apple Wallet button and add-pass sheet"
  s.description    = 'PKAddPassButton and PKAddPassesViewController for the Open Cinema app'
  s.author         = ''
  s.homepage       = 'https://docs.expo.dev/modules/'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'
  s.frameworks = 'PassKit'

  # Swift/Objective-C compatibility
  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
  }

  s.source_files = "**/*.{h,m,mm,swift,hpp,cpp}"
end
