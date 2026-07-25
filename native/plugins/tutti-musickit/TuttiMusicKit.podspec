require 'json'

package = JSON.parse(File.read(File.join(__dir__, 'package.json')))

Pod::Spec.new do |s|
  s.name = 'TuttiMusicKit'
  s.version = package['version']
  s.summary = package['description']
  s.license = 'MIT'
  s.homepage = 'https://tutti.app'
  s.author = 'Tutti'
  s.source = { :git => 'https://tutti.app', :tag => s.version.to_s }
  s.source_files = 'ios/Plugin/**/*.{swift,h,m}'
  s.ios.deployment_target = '15.0'
  s.dependency 'Capacitor'
  s.swift_version = '5.1'
  s.frameworks = 'MusicKit'
end
