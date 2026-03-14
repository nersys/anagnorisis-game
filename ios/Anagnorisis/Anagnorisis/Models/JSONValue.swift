import Foundation

/// A type-erased JSON value — used for decoding arbitrary WebSocket payloads.
enum JSONValue: Codable, Equatable {
    case string(String)
    case int(Int)
    case double(Double)
    case bool(Bool)
    case object([String: JSONValue])
    case array([JSONValue])
    case null

    // MARK: Codable

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil()              { self = .null; return }
        if let b = try? container.decode(Bool.self)              { self = .bool(b);   return }
        if let i = try? container.decode(Int.self)               { self = .int(i);    return }
        if let d = try? container.decode(Double.self)            { self = .double(d); return }
        if let s = try? container.decode(String.self)            { self = .string(s); return }
        if let a = try? container.decode([JSONValue].self)       { self = .array(a);  return }
        if let o = try? container.decode([String: JSONValue].self) { self = .object(o); return }
        throw DecodingError.dataCorruptedError(in: container, debugDescription: "Unknown JSON type")
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .null:          try container.encodeNil()
        case .bool(let b):   try container.encode(b)
        case .int(let i):    try container.encode(i)
        case .double(let d): try container.encode(d)
        case .string(let s): try container.encode(s)
        case .array(let a):  try container.encode(a)
        case .object(let o): try container.encode(o)
        }
    }

    // MARK: Convenient accessors

    var stringValue: String?     { if case .string(let s) = self { return s }; return nil }
    var intValue: Int?           { if case .int(let i)    = self { return i }; return nil }
    var doubleValue: Double?     { if case .double(let d) = self { return d }; return nil }
    var boolValue: Bool?         { if case .bool(let b)   = self { return b }; return nil }
    var objectValue: [String: JSONValue]? { if case .object(let o) = self { return o }; return nil }
    var arrayValue: [JSONValue]? { if case .array(let a)  = self { return a }; return nil }

    subscript(key: String) -> JSONValue? { objectValue?[key] }
    subscript(index: Int)  -> JSONValue? {
        guard case .array(let a) = self, index < a.count else { return nil }
        return a[index]
    }

    // MARK: Decode into Codable type

    func decode<T: Decodable>(_ type: T.Type) throws -> T {
        let data = try JSONEncoder().encode(self)
        return try JSONDecoder().decode(type, from: data)
    }
}

// MARK: - WebSocket message envelope

struct WSMessage: Codable {
    let id: String?
    let type: String
    let payload: [String: JSONValue]
}

extension WSMessage {
    func payloadString(_ key: String) -> String? { payload[key]?.stringValue }
    func payloadInt(_ key: String) -> Int?        { payload[key]?.intValue }
    func payloadBool(_ key: String) -> Bool?      { payload[key]?.boolValue }
    func payloadObject(_ key: String) -> [String: JSONValue]? { payload[key]?.objectValue }
    func payloadArray(_ key: String) -> [JSONValue]? { payload[key]?.arrayValue }

    func decodePayloadKey<T: Decodable>(_ key: String, as type: T.Type) -> T? {
        guard let val = payload[key] else { return nil }
        return try? val.decode(type)
    }
}
