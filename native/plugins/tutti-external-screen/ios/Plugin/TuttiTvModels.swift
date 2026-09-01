import Foundation

/**
 * TuttiTvModels — modèle de données de l'ÉCRAN TV NATIF.
 *
 * La TV native lit exactement la même source que la version web : l'endpoint
 * public `GET {apiBase}/api/workspace/screen-state/{workspaceId}`. Aucun
 * navigateur n'est impliqué : URLSession + JSONDecoder, rendu UIKit.
 *
 * Le JSON est une union discriminée sur `state`. On la décode en UNE structure
 * à champs optionnels : plus robuste qu'un enum Codable (un champ ajouté côté
 * serveur ne casse jamais le décodage, la TV continue d'afficher).
 */

struct TvCorrectAnswer: Decodable {
    let pseudo: String
    let position: Int
    let score: Int
    let participantId: String?
    let teamId: String?

    enum CodingKeys: String, CodingKey {
        case pseudo, position, score
        case participantId = "participant_id"
        case teamId = "team_id"
    }
}

struct TvScore: Decodable {
    let id: String
    let label: String
    let color: String?
    let totalPoints: Int

    enum CodingKeys: String, CodingKey {
        case id, label, color
        case totalPoints = "total_points"
    }
}

struct TvRoundRank: Decodable {
    let pseudo: String
    let points: Int
    let rank: Int
}

struct TvPlayer: Decodable {
    let id: String
    let pseudo: String
}

struct TvTrack: Decodable {
    let trackId: String
    let trackIndex: Int
    let artist: String
    let title: String
    let coverUrl: String?
    let startedAt: String?
    let durationMs: Int?
    let phase: String
    let phase2StartedAt: String?
    let correctAnswers: [TvCorrectAnswer]?

    enum CodingKeys: String, CodingKey {
        case artist, title, phase
        case trackId = "track_id"
        case trackIndex = "track_index"
        case coverUrl = "cover_url"
        case startedAt = "started_at"
        case durationMs = "duration_ms"
        case phase2StartedAt = "phase2_started_at"
        case correctAnswers = "correct_answers"
    }

    /// Le morceau est-il révélé (titre + artiste affichables) ?
    var isRevealed: Bool {
        return phase == "phase3" || phase == "phase3-revealed"
    }

    var isPhase2: Bool {
        return phase == "phase2"
    }
}

/// Vue minimale de la session : manche en cours, playlist, état pause.
struct TvPlaylistLite: Decodable {
    let name: String
    let tracksCount: Int?

    enum CodingKeys: String, CodingKey {
        case name
        case tracksCount = "tracks_count"
    }
}

struct TvRoundLite: Decodable {
    let status: String
    let position: Int
    let playlist: TvPlaylistLite
}

struct TvSessionLite: Decodable {
    let shortCode: String?
    let isPaused: Bool?
    let rounds: [TvRoundLite]?

    enum CodingKeys: String, CodingKey {
        case rounds
        case shortCode = "short_code"
        case isPaused = "is_paused"
    }
}

struct TvScreenState: Decodable {
    let state: String
    let sessionId: String?
    let joinCode: String?
    let sessionName: String?
    let players: [TvPlayer]?
    let session: TvSessionLite?
    let currentTrack: TvTrack?
    let cumulative: [TvScore]?
    let correctAnswers: [TvCorrectAnswer]?
    let phase2StartedAt: String?
    let roundPosition: Int?
    let roundsTotal: Int?
    let roundRanking: [TvRoundRank]?
    let finalScores: [TvScore]?
    let lastEndedRoundPosition: Int?
    let qrOverlay: Bool?

    enum CodingKeys: String, CodingKey {
        case state, sessionId, joinCode, sessionName, players, session, currentTrack
        case cumulative, correctAnswers, phase2StartedAt, roundPosition, roundsTotal
        case roundRanking, finalScores, lastEndedRoundPosition
        case qrOverlay = "qr_overlay"
    }
}

/// Position de lecture poussée par la console (même app, même processus) →
/// barre de progression et chronos parfaitement collés au son, sans réseau.
struct TvPlayback {
    var positionMs: Double = 0
    var durationMs: Double = 0
    var isPaused: Bool = true
    /// Horodatage local de la dernière mise à jour, pour extrapoler entre deux.
    var receivedAt: TimeInterval = 0

    /// Position extrapolée à l'instant présent.
    func currentPositionMs() -> Double {
        if isPaused || receivedAt <= 0 { return positionMs }
        let elapsed = (Date().timeIntervalSince1970 - receivedAt) * 1000.0
        let value = positionMs + elapsed
        if durationMs > 0 && value > durationMs { return durationMs }
        return value
    }
}

/// Interroge le serveur en boucle et publie l'état décodé.
final class TuttiTvPoller {

    private let apiBase: String
    private let workspaceId: String
    private var timer: Timer?
    private var inFlight = false
    private let session: URLSession
    private let onState: (TvScreenState?) -> Void

    init(apiBase: String, workspaceId: String, onState: @escaping (TvScreenState?) -> Void) {
        self.apiBase = apiBase
        self.workspaceId = workspaceId
        self.onState = onState
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 8
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        self.session = URLSession(configuration: config)
    }

    func start() {
        stop()
        fetchOnce()
        let t = Timer(timeInterval: 1.0, repeats: true) { [weak self] _ in
            self?.fetchOnce()
        }
        RunLoop.main.add(t, forMode: .common)
        timer = t
    }

    func stop() {
        timer?.invalidate()
        timer = nil
    }

    private func fetchOnce() {
        if inFlight { return }
        let base = apiBase.hasSuffix("/") ? String(apiBase.dropLast()) : apiBase
        let encoded = workspaceId.addingPercentEncoding(
            withAllowedCharacters: .urlPathAllowed) ?? workspaceId
        guard let url = URL(string: "\(base)/api/workspace/screen-state/\(encoded)") else { return }
        inFlight = true
        let task = session.dataTask(with: url) { [weak self] data, _, _ in
            guard let self = self else { return }
            self.inFlight = false
            var decoded: TvScreenState?
            if let data = data {
                decoded = try? JSONDecoder().decode(TvScreenState.self, from: data)
            }
            DispatchQueue.main.async {
                self.onState(decoded)
            }
        }
        task.resume()
    }
}
