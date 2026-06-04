from blueprints.auth_routes import bp as auth_bp
from blueprints.profile import bp as profile_bp
from blueprints.interactions import bp as interactions_bp
from blueprints.weak_points import bp as weak_points_bp
from blueprints.qa import bp as qa_bp
from blueprints.textbook import bp as textbook_bp
from blueprints.practice import bp as practice_bp
from blueprints.calendar import bp as calendar_bp
from blueprints.feynman import bp as feynman_bp
from blueprints.learning_path import bp as learning_path_bp
from blueprints.knowledge_graph import bp as knowledge_graph_bp
from blueprints.pet import bp as pet_bp
from blueprints.user_profile_doc import bp as user_profile_doc_bp
from blueprints.wrong_questions import bp as wrong_questions_bp
from blueprints.essay_grading import bp as essay_grading_bp
from blueprints.knowledge_memories import bp as knowledge_memories_bp
from blueprints.tutoring import bp as tutoring_bp


BLUEPRINTS = [
    auth_bp,
    profile_bp,
    interactions_bp,
    weak_points_bp,
    qa_bp,
    textbook_bp,
    practice_bp,
    calendar_bp,
    feynman_bp,
    learning_path_bp,
    knowledge_graph_bp,
    pet_bp,
    user_profile_doc_bp,
    wrong_questions_bp,
    essay_grading_bp,
    knowledge_memories_bp,
    tutoring_bp,
]
