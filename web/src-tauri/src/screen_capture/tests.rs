use super::*;

#[test]
fn tela_exclui_a_arvore_do_stapp() {
    assert_eq!(
        make_audio_target(SourceLocator::Screen(7), None, 42),
        Ok(AudioTarget {
            process_id: 42,
            include_tree: false,
        }),
    );
}

#[test]
fn janela_inclui_somente_a_arvore_escolhida_e_recusa_o_stapp() {
    assert_eq!(
        make_audio_target(SourceLocator::Window(7), Some(88), 42),
        Ok(AudioTarget {
            process_id: 88,
            include_tree: true,
        }),
    );
    assert!(make_audio_target(SourceLocator::Window(7), Some(42), 42).is_err());
    assert!(make_audio_target(SourceLocator::Window(7), None, 42).is_err());
}

#[test]
fn pcm_so_sai_em_blocos_completos_e_preserva_o_restante() {
    let mut samples = VecDeque::from(vec![1, 2, 3, 4, 5, 6]);
    assert_eq!(take_pcm_chunk(&mut samples, 4), Some(vec![1, 2, 3, 4]));
    assert_eq!(take_pcm_chunk(&mut samples, 4), None);
    assert_eq!(samples, VecDeque::from(vec![5, 6]));
}

#[test]
fn validacao_de_exclusao_falha_fechada() {
    assert!(exclusion_is_safe(0.02, 0.0002));
    assert!(!exclusion_is_safe(0.0, 0.0));
    assert!(!exclusion_is_safe(0.02, 0.01));
}

#[test]
fn detector_encontra_o_probe_de_dezoito_khz() {
    let mut pcm = VecDeque::new();
    for index in 0..4_800 {
        let sample = (2.0 * std::f64::consts::PI * 18_000.0 * index as f64 / 48_000.0).sin()
            as f32
            * 0.02;
        pcm.extend(sample.to_le_bytes());
        pcm.extend(sample.to_le_bytes());
    }
    assert!(goertzel_level(&pcm, 48_000.0, 18_000.0, 2) > 0.01);
}
