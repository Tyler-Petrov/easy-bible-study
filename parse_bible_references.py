import json
import sqlite3

db = sqlite3.connect("./bible_versions/kjv.db")

# with open("./bible_books.json", "r") as books_file:
#     bible_books = json.load(books_file)

#     for index, book in enumerate(bible_books):
#         book_id = index + 1
#         query_str = f"insert into Books values ({book_id}, '{book['name']}')"
#         # db.execute(query_str)

#         for alias in book["aliases"]:
#             db.execute(
#                 f"insert into BookNames (Name, Book_id) values ('{alias}', {book_id})"
#             )

# with open("./bible_versions/kjv.json", "r") as kjv_bible:
#     kjv = json.load(kjv_bible)["books"]

#     for book in kjv:
#         book_name = book["book"]

#         book_query = db.execute(f"select * from Books where Name = '{book_name}'")
#         book_obj = book_query.fetchone()
#         book_id = book_obj[0]

#         chapters = book["chapters"]
#         for chapter in chapters:
#             chapter_num = chapter["chapter"]
#             verses = chapter["verses"]

#             for verse in verses:
#                 verse_num = verse["verse"]
#                 content = verse["text"]

#                 db.execute(
#                     f"insert into Verses (Book_id, Chapter, Verse, Content)"
#                     f"values ({book_id}, {chapter_num}, {verse_num}, '{content}')"
#                 )


def verse_from_reference_str(reference_str):
    verse_reference_str: str = str(reference_str).lower()

    book_name_abv, chapter, verse = verse_reference_str.split()

    book_name_query = db.execute(
        f"select * from BookNames where lower(Name) = lower('{book_name_abv}')"
    ).fetchone()

    try:
        book_id = book_name_query[2]
    except TypeError:
        print(reference_str)
        raise

    return db.execute(
        f"select * from Verses "
        f"where Book_id = {book_id} and Chapter = {chapter} and Verse = {verse}"
    ).fetchone()


for json_file_number in range(1, 33):
    print(json_file_number)
    with open(
        f"./bible-cross-reference-json-master/{json_file_number}.json", "r"
    ) as cross_reference_json_file:
        cross_reference_json = json.load(cross_reference_json_file)

        for data in cross_reference_json.values():
            left_verse_query = verse_from_reference_str(data["v"])

            verse1_id = left_verse_query[0]

            try:
                references = data["r"].values()
            except KeyError:
                references = []

            for right_verse_reference in references:
                right_verse_query = verse_from_reference_str(right_verse_reference)
                verse2_id = right_verse_query[0]

                db.execute(
                    f"insert into CrossReferences (Verse1, Verse2) values ({verse1_id}, {verse2_id})"
                )

db.commit()
