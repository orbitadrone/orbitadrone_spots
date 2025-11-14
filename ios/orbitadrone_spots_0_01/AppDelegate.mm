#import "AppDelegate.h"

#import <React/RCTBundleURLProvider.h>

#if __has_include(<Firebase.h>)
#import <Firebase.h>
#define HAS_FIREBASE 1
#else
#define HAS_FIREBASE 0
#endif

#if __has_include(<ReactNativeConfig/ReactNativeConfig.h>)
#import <ReactNativeConfig/ReactNativeConfig.h>
#define HAS_REACT_NATIVE_CONFIG 1
#else
#define HAS_REACT_NATIVE_CONFIG 0
#endif

#if __has_include(<GoogleMaps/GMSServices.h>)
#import <GoogleMaps/GMSServices.h>
#define HAS_GOOGLE_MAPS 1
#else
#define HAS_GOOGLE_MAPS 0
#endif

@implementation AppDelegate

- (BOOL)application:(UIApplication *)application didFinishLaunchingWithOptions:(NSDictionary *)launchOptions
{
#if HAS_FIREBASE
  if ([FIRApp defaultApp] == nil) {
    [FIRApp configure];
  }
#endif

#if HAS_REACT_NATIVE_CONFIG && HAS_GOOGLE_MAPS
  NSString *iosMapsApiKey = [ReactNativeConfig envFor:@"GOOGLE_MAPS_API_KEY_IOS"];
  if (iosMapsApiKey.length > 0) {
    [GMSServices provideAPIKey:iosMapsApiKey];
  } else {
    NSLog(@"[Orbitadrone] GOOGLE_MAPS_API_KEY_IOS is missing. Google Maps tiles will not load on iOS.");
  }
#endif

  self.moduleName = @"orbitadrone_spots_0_01";
  // You can add your custom initial props in the dictionary below.
  // They will be passed down to the ViewController used by React Native.
  self.initialProps = @{};

  return [super application:application didFinishLaunchingWithOptions:launchOptions];
}

- (NSURL *)sourceURLForBridge:(RCTBridge *)bridge
{
  return [self bundleURL];
}

- (NSURL *)bundleURL
{
#if DEBUG
  return [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@"index"];
#else
  return [[NSBundle mainBundle] URLForResource:@"main" withExtension:@"jsbundle"];
#endif
}

@end
