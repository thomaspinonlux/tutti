#import <Foundation/Foundation.h>
#import <Capacitor/Capacitor.h>

// Enregistre le plugin + ses méthodes auprès du bridge Capacitor. Le nom
// « TuttiMusicKit » est celui utilisé côté JS (registerPlugin / bridge global).
CAP_PLUGIN(TuttiMusicKitPlugin, "TuttiMusicKit",
    CAP_PLUGIN_METHOD(authorize, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(getUserToken, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(play, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(pause, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(resume, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(seek, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(setVolume, CAPPluginReturnPromise);
    CAP_PLUGIN_METHOD(getStatus, CAPPluginReturnPromise);
)
