use super::*;
use std::{io::Write, net::TcpListener};

fn candidate(id: u64, title: &str) -> Candidate {
    Candidate {
        id,
        title: title.into(),
    }
}

fn artist(name: &str, variations: &[&str], photos: &[(&str, &str)]) -> Artist {
    Artist {
        name: name.into(),
        namevariations: variations.iter().map(|name| (*name).into()).collect(),
        images: photos
            .iter()
            .map(|(kind, uri)| Photo {
                kind: (*kind).into(),
                uri: (*uri).into(),
            })
            .collect(),
    }
}

#[test]
fn exact_names_precede_fuzzy_results_and_primary_photos_precede_secondary() {
    let mut requested = Vec::new();
    let found = select(
        " Radiohead ",
        vec![
            candidate(1, "Radiohead Tribute"),
            candidate(3840, "RADIOHEAD"),
        ],
        |id| {
            requested.push(id);
            Ok(artist(
                "Radiohead",
                &[],
                &[("secondary", "second"), ("primary", "first")],
            ))
        },
    )
    .unwrap();
    assert_eq!(found.as_deref(), Some("first"));
    assert_eq!(requested, [3840]);
}

#[test]
fn name_variations_match_chinese_and_japanese_search_results() {
    for (query, name, variation) in [
        ("周杰伦", "Jay Chou", "周杰伦"),
        ("宇多田ヒカル", "Utada Hikaru", "宇多田ヒカル"),
    ] {
        let found = select(query, vec![candidate(1, name)], |_| {
            Ok(artist(name, &[variation], &[("primary", "photo")]))
        })
        .unwrap();
        assert_eq!(found.as_deref(), Some("photo"));
    }
}

#[test]
fn discogs_numeric_suffixes_match_but_other_parentheses_remain_significant() {
    assert_eq!(normalized("Air (2)"), "air");
    assert_eq!(normalized("Air (Live)"), "air (live)");
    assert_eq!(normalized("Air ()"), "air ()");
    let mut requested = Vec::new();
    assert_eq!(
        select(
            "Air",
            vec![candidate(1, "Air (2)"), candidate(2, "Air (3)")],
            |id| {
                requested.push(id);
                Ok(artist("Air (2)", &[], &[("secondary", "photo")]))
            }
        )
        .unwrap()
        .as_deref(),
        Some("photo")
    );
    assert_eq!(requested, [1]);
}

#[test]
fn no_results_no_matching_name_and_no_photos_are_distinct_from_errors() {
    assert!(select("Missing", vec![], |_| panic!("empty search"))
        .unwrap()
        .is_none());
    assert!(select("Air", vec![candidate(1, "Air Supply")], |_| {
        Ok(artist("Air Supply", &[], &[("primary", "wrong")]))
    })
    .unwrap()
    .is_none());
    assert!(select("Air", vec![candidate(1, "Air")], |_| {
        Ok(artist("Air", &[], &[]))
    })
    .unwrap()
    .is_none());
    assert!(select("Air", vec![candidate(1, "Air")], |_| Err("timeout".into())).is_err());
    assert!(select("Air", vec![candidate(0, "Air")], |_| panic!("invalid id")).is_err());
    assert!(serde_json::from_str::<Search>(r#"{"error":"rate limited"}"#).is_err());
    assert!(
        serde_json::from_str::<Artist>(r#"{"name":"Air","images":[{"uri":"photo"}]}"#).is_err()
    );
}

fn response(status: &str, body: &str) -> Response {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let message = format!(
        "HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let server = std::thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut request = [0; 4096];
        let received = stream.read(&mut request).unwrap();
        assert!(received > 0);
        stream.write_all(message.as_bytes()).unwrap();
    });
    let response = Client::builder()
        .no_proxy()
        .build()
        .unwrap()
        .get(format!("http://{address}"))
        .send()
        .unwrap();
    server.join().unwrap();
    response
}

#[test]
fn response_errors_and_oversized_bodies_are_not_missing_photos() {
    assert_eq!(bytes(response("200 OK", "data"), 4).unwrap(), b"data");
    assert!(bytes(response("200 OK", "extra"), 4).is_err());
    assert!(bytes(response("429 Too Many Requests", "limited"), 100).is_err());
    assert!(bytes(response("503 Service Unavailable", "offline"), 100).is_err());
}
