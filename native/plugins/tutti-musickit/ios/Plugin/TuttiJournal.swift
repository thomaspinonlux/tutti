import Foundation
import UIKit
import MetricKit

/**
 * TuttiJournal — JOURNAL NATIF ENVOYÉ AU SERVEUR.
 *
 * Pourquoi : quand l'app se fige sur l'iPad, personne ne peut lire quoi que ce
 * soit sur place, et les journaux du serveur s'arrêtent net — on ne sait que
 * l'heure du silence, jamais l'étape. Ce journal note chaque étape des
 * greffons natifs (lecteur Apple Music, écran externe), l'envoie au serveur
 * depuis une file d'arrière-plan qui ne dépend PAS du fil principal, et
 * surveille le fil principal lui-même : s'il ne répond plus, une ligne part
 * avec la liste des opérations en cours et leur ancienneté. La dernière ligne
 * reçue avant le silence dit exactement où ça bloque.
 *
 * Aucune donnée personnelle. Volume borné. Jamais bloquant : tout est
 * asynchrone, sur une file dédiée, et une erreur d'envoi est ignorée.
 */
final class TuttiJournal {

    static let shared = TuttiJournal()

    private let file = DispatchQueue(label: "app.tutti.journal", qos: .utility)
    private let verrou = NSLock()
    private var apiBase = "https://api.tuttiparty.app"
    private var tampon: [[String: Any]] = []
    private var envoiPrevu = false
    private var operations: [String: (nom: String, depuis: CFAbsoluteTime, fil: String)] = [:]
    private var compteur = 0
    private let session: URLSession
    private let demarrage = CFAbsoluteTimeGetCurrent()
    private var surveillanceLancee = false

    private init() {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 6
        session = URLSession(configuration: config)
    }

    func configurer(apiBase: String) {
        verrou.lock(); defer { verrou.unlock() }
        let nettoye = apiBase.hasSuffix("/") ? String(apiBase.dropLast()) : apiBase
        if !nettoye.isEmpty { self.apiBase = nettoye }
    }

    // MARK: - Écriture

    /** Note une étape. `details` : petites valeurs simples uniquement. */
    func note(_ source: String, _ etape: String, _ details: [String: Any] = [:], niveau: String = "info") {
        var ligne: [String: Any] = [
            "t": Int((CFAbsoluteTimeGetCurrent() - demarrage) * 1000),
            "fil": Thread.isMainThread ? "principal" : "fond",
            "source": source,
            "etape": etape,
            "niveau": niveau,
        ]
        if !details.isEmpty { ligne["details"] = details }
        verrou.lock()
        tampon.append(ligne)
        if tampon.count > 200 { tampon.removeFirst(tampon.count - 200) }
        let doitPlanifier = !envoiPrevu
        envoiPrevu = true
        verrou.unlock()
        if doitPlanifier {
            file.asyncAfter(deadline: .now() + 0.3) { [weak self] in self?.vider() }
        }
    }

    /** Marque le début d'une opération surveillée. Rend un jeton pour `fin`. */
    func debut(_ source: String, _ nom: String, _ details: [String: Any] = [:], silencieux: Bool = false) -> String {
        verrou.lock()
        compteur += 1
        let jeton = "\(nom)#\(compteur)"
        operations[jeton] = (nom, CFAbsoluteTimeGetCurrent(), Thread.isMainThread ? "principal" : "fond")
        verrou.unlock()
        if !silencieux { note(source, "▶ \(nom)", details) }
        return jeton
    }

    /** Marque la fin d'une opération. Note sa durée. */
    func fin(_ source: String, _ jeton: String, _ details: [String: Any] = [:]) {
        verrou.lock()
        let op = operations.removeValue(forKey: jeton)
        verrou.unlock()
        var d = details
        if let op = op {
            d["dureeMs"] = Int((CFAbsoluteTimeGetCurrent() - op.depuis) * 1000)
            note(source, "■ \(op.nom)", d)
        } else {
            note(source, "■ \(jeton) (jeton inconnu)", d, niveau: "warn")
        }
    }

    /** Termine une opération fréquente : ne note que si elle a dépassé le seuil. */
    func finSiLent(_ source: String, _ jeton: String, seuilMs: Int) {
        verrou.lock()
        let op = operations.removeValue(forKey: jeton)
        verrou.unlock()
        guard let op = op else { return }
        let duree = Int((CFAbsoluteTimeGetCurrent() - op.depuis) * 1000)
        if duree >= seuilMs {
            note(source, "■ \(op.nom) LENT", ["dureeMs": duree], niveau: "warn")
        }
    }

    /// État de l'application, tenu à jour depuis le fil principal (cf. démarrage).
    /// `true` par défaut : au lancement l'app est active.
    private let verrouActivite = NSLock()
    private var applicationActive = true

    private func marquerApplicationActive(_ actif: Bool) {
        verrouActivite.lock(); defer { verrouActivite.unlock() }
        applicationActive = actif
    }

    private func applicationEstActive() -> Bool {
        verrouActivite.lock(); defer { verrouActivite.unlock() }
        return applicationActive
    }

    private func operationsEnCours() -> [String] {
        verrou.lock(); defer { verrou.unlock() }
        let maintenant = CFAbsoluteTimeGetCurrent()
        return operations.map { (_, v) in
            "\(v.nom) [\(v.fil)] depuis \(Int((maintenant - v.depuis) * 1000)) ms"
        }.sorted()
    }

    // MARK: - Envoi

    private func vider() {
        verrou.lock()
        let lignes = tampon
        tampon.removeAll()
        envoiPrevu = false
        let base = apiBase
        verrou.unlock()
        guard !lignes.isEmpty, let url = URL(string: base + "/api/client-log/natif") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue("1", forHTTPHeaderField: "x-tutti-natif")
        let corps: [String: Any] = [
            "appareil": UIDevice.current.model,
            "systeme": UIDevice.current.systemVersion,
            "lignes": lignes,
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: corps) else { return }
        req.httpBody = data
        session.dataTask(with: req) { _, _, _ in }.resume()
    }

    // MARK: - Surveillance du fil principal

    /**
     * Un fil indépendant (pas GCD, pour ne dépendre de rien) envoie un signal
     * au fil principal toutes les 500 ms. Si le signal n'est pas traité en
     * 1,5 s, le fil principal est bloqué : on note l'ancienneté du blocage et
     * les opérations en cours, puis on répète toutes les 5 s. Au retour, on
     * note la durée totale.
     */
    func lancerSurveillance() {
        verrou.lock()
        if surveillanceLancee { verrou.unlock(); return }
        surveillanceLancee = true
        verrou.unlock()

        NotificationCenter.default.addObserver(forName: UIApplication.didReceiveMemoryWarningNotification, object: nil, queue: nil) { [weak self] _ in
            self?.note("systeme", "AVERTISSEMENT MÉMOIRE", ["residentMo": TuttiJournal.memoireResidenteMo()], niveau: "warn")
        }
        // fix/fausse-alarme-de-surveillance — L'APP EN VEILLE N'EST PAS UNE PANNE.
        //
        // Le 09/09 à 18:59:21, Thomas met la musique en PAUSE (▶ pause, 3 ms,
        // dans le journal). 1,5 s plus tard : « FIL PRINCIPAL BLOQUÉ », répété
        // pendant 2 min 07, puis plus aucune ligne. Rien n'était bloqué :
        // musique en pause = plus rien qui justifie de garder l'app éveillée,
        // iOS la met en veille, le fil principal cesse de traiter les blocs, et
        // la surveillance — qui ne mesure QUE ça — crie au blocage.
        //
        // On mémorise donc l'état de l'application à chaque changement (sur le
        // fil principal, où les notifications arrivent) et le fil de
        // surveillance se contente de LIRE ce drapeau : il n'interroge jamais
        // UIApplication lui-même, ce qui exigerait le fil principal — celui-là
        // même qu'il soupçonne.
        NotificationCenter.default.addObserver(forName: UIApplication.willResignActiveNotification, object: nil, queue: nil) { [weak self] _ in
            self?.marquerApplicationActive(false)
            self?.note("systeme", "app va passer inactive")
        }
        NotificationCenter.default.addObserver(forName: UIApplication.didBecomeActiveNotification, object: nil, queue: nil) { [weak self] _ in
            self?.marquerApplicationActive(true)
            self?.note("systeme", "app active", ["residentMo": TuttiJournal.memoireResidenteMo()])
        }
        NotificationCenter.default.addObserver(forName: UIApplication.willTerminateNotification, object: nil, queue: nil) { [weak self] _ in
            self?.note("systeme", "app va se TERMINER", niveau: "warn")
        }

        let fil = Thread { [weak self] in
            var enAttente = false
            var enVeilleSignalee = false
            var bloqueDepuis: CFAbsoluteTime = 0
            var dernierRapport: CFAbsoluteTime = 0
            var signalRecu = true
            let verrouLocal = NSLock()
            while true {
                Thread.sleep(forTimeInterval: 0.5)
                guard let self = self else { return }
                verrouLocal.lock(); let recu = signalRecu; verrouLocal.unlock()
                if recu {
                    // Le précédent a été traité : on en envoie un nouveau.
                    if enAttente {
                        // On était bloqué et ça vient de reprendre.
                        let duree = Int((CFAbsoluteTimeGetCurrent() - bloqueDepuis) * 1000)
                        self.note("surveillance", "FIL PRINCIPAL REPRIS", ["bloqueMs": duree], niveau: "warn")
                        enAttente = false
                    }
                    enVeilleSignalee = false
                    verrouLocal.lock(); signalRecu = false; verrouLocal.unlock()
                    let envoye = CFAbsoluteTimeGetCurrent()
                    bloqueDepuis = envoye
                    DispatchQueue.main.async {
                        verrouLocal.lock(); signalRecu = true; verrouLocal.unlock()
                    }
                } else {
                    let depuis = CFAbsoluteTimeGetCurrent() - bloqueDepuis
                    // App en veille : le fil principal ne traite plus rien, et
                    // c'est NORMAL. On le note une fois, en information, et on
                    // se tait tant qu'elle n'est pas revenue au premier plan.
                    guard self.applicationEstActive() else {
                        if !enVeilleSignalee {
                            enVeilleSignalee = true
                            self.note("surveillance", "app en veille — surveillance suspendue", [
                                "depuisMs": Int(depuis * 1000),
                            ])
                        }
                        // Une alerte en cours au moment de la mise en veille
                        // est abandonnée : sinon le réveil publierait un
                        // « FIL PRINCIPAL REPRIS » de plusieurs minutes qui ne
                        // mesurerait que la durée du sommeil.
                        enAttente = false
                        continue
                    }
                    if depuis >= 1.5 {
                        let maintenant = CFAbsoluteTimeGetCurrent()
                        if !enAttente || maintenant - dernierRapport >= 5 {
                            enAttente = true
                            dernierRapport = maintenant
                            self.note("surveillance", "FIL PRINCIPAL BLOQUÉ", [
                                "depuisMs": Int(depuis * 1000),
                                "operationsEnCours": self.operationsEnCours(),
                                "residentMo": TuttiJournal.memoireResidenteMo(),
                            ], niveau: "error")
                        }
                    }
                }
            }
        }
        fil.name = "tutti.surveillance"
        fil.qualityOfService = .userInitiated
        fil.start()
        note("surveillance", "surveillance du fil principal démarrée", [
            "residentMo": TuttiJournal.memoireResidenteMo(),
        ])
        // diag/pile-du-fil-principal — MetricKit.
        // Ma surveillance sait dire « le fil principal ne répond plus » ; elle
        // ne sait pas dire CE QU'IL FAIT. iOS, lui, l'enregistre : à chaque
        // blocage du fil principal, MetricKit capture la pile d'appels et la
        // livre à l'app (au plus tard au lancement suivant). On l'envoie au
        // journal serveur telle quelle : la prochaine fois que l'iPad gèle,
        // le coupable a un nom de fonction, pas une supposition.
        if #available(iOS 14.0, *) {
            MXMetricManager.shared.add(recepteurMetricKit)
        }
    }

    private lazy var recepteurMetricKit = RecepteurMetricKit()

    static func memoireResidenteMo() -> Int {
        var info = mach_task_basic_info()
        var count = mach_msg_type_number_t(MemoryLayout<mach_task_basic_info>.size) / 4
        let resultat = withUnsafeMutablePointer(to: &info) {
            $0.withMemoryRebound(to: integer_t.self, capacity: Int(count)) {
                task_info(mach_task_self_, task_flavor_t(MACH_TASK_BASIC_INFO), $0, &count)
            }
        }
        guard resultat == KERN_SUCCESS else { return -1 }
        return Int(info.resident_size / (1024 * 1024))
    }
}

// MARK: - MetricKit : piles d'appels des blocages, livrées par iOS

@available(iOS 14.0, *)
private final class RecepteurMetricKit: NSObject, MXMetricManagerSubscriber {

    func didReceive(_ payloads: [MXDiagnosticPayload]) {
        for charge in payloads {
            for blocage in charge.hangDiagnostics ?? [] {
                let duree = Int(blocage.hangDuration.converted(to: .milliseconds).value)
                let pile = RecepteurMetricKit.pileLisible(blocage.callStackTree)
                TuttiJournal.shared.note("metrickit", "BLOCAGE ENREGISTRÉ PAR iOS — pile du fil principal", [
                    "dureeMs": duree,
                    "debutFenetre": ISO8601DateFormatter().string(from: charge.timeStampBegin),
                    "finFenetre": ISO8601DateFormatter().string(from: charge.timeStampEnd),
                    "pile": pile,
                ], niveau: "error")
            }
            for plantage in charge.crashDiagnostics ?? [] {
                TuttiJournal.shared.note("metrickit", "PLANTAGE ENREGISTRÉ PAR iOS", [
                    "signal": plantage.signal?.intValue ?? -1,
                    "raison": plantage.terminationReason ?? "",
                    "pile": RecepteurMetricKit.pileLisible(plantage.callStackTree),
                ], niveau: "error")
            }
        }
    }

    func didReceive(_ payloads: [MXMetricPayload]) {
        // Métriques agrégées quotidiennes : le taux de blocage suffit.
        for charge in payloads {
            if let app = charge.applicationResponsivenessMetrics {
                TuttiJournal.shared.note("metrickit", "réactivité du jour", [
                    "histogrammeBlocages": app.histogrammedApplicationHangTime.description,
                ])
            }
        }
    }

    /// Réduit l'arbre de piles MetricKit (JSON) aux 60 premières trames du fil
    /// principal, du plus récent au plus ancien — c'est ce qu'il faut lire.
    private static func pileLisible(_ arbre: MXCallStackTree) -> String {
        let donnees = arbre.jsonRepresentation()
        guard let racine = try? JSONSerialization.jsonObject(with: donnees) as? [String: Any],
              let piles = racine["callStacks"] as? [[String: Any]] else {
            return String(decoding: donnees.prefix(6_000), as: UTF8.self)
        }
        // Le fil principal est marqué threadAttributed=true.
        let principale = piles.first { ($0["threadAttributed"] as? Bool) == true } ?? piles.first
        guard let principale, let trames = principale["callStackRootFrames"] as? [[String: Any]] else {
            return String(decoding: donnees.prefix(6_000), as: UTF8.self)
        }
        var lignes: [String] = []
        func parcourir(_ trame: [String: Any], profondeur: Int) {
            guard lignes.count < 60 else { return }
            let binaire = (trame["binaryName"] as? String) ?? "?"
            let decalage = (trame["offsetIntoBinaryTextSegment"] as? Int) ?? 0
            let adresse = (trame["address"] as? Int) ?? 0
            lignes.append("\(profondeur) \(binaire) +\(decalage) @\(String(adresse, radix: 16))")
            for sous in (trame["subFrames"] as? [[String: Any]]) ?? [] {
                parcourir(sous, profondeur: profondeur + 1)
            }
        }
        for t in trames { parcourir(t, profondeur: 0) }
        return lignes.joined(separator: " | ")
    }
}
