from services.learning_service import has_weakness_evidence, is_non_learning_input


def test_has_weakness_evidence_detects_common_chinese_signals():
    assert has_weakness_evidence('我不会一次函数，哪里错了？', 'qa') is True
    assert has_weakness_evidence('这题我卡住了，还是不懂', 'qa') is True


def test_non_learning_greetings_are_filtered():
    assert is_non_learning_input('你是谁') is True
    assert is_non_learning_input('你好') is True
