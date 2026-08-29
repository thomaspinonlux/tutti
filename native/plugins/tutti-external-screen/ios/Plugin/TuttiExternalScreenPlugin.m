#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

CAP_PLUGIN(TuttiExternalScreenPlugin, "TuttiExternalScreen",
    CAP_PLUGIN_METHOD(isConnected, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(present, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(presentNative, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(updatePlayback, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(dismiss, CAPPluginReturnPromise);
)
