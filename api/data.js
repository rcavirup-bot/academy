// Vercel Serverless Function: /api/data.js
// Interfaces with MongoDB for persistent Academy data management

import { getDatabase } from './lib/mongodb.js';

const COLLECTIONS = {
  PROFILE: 'profile',
  COURSES: 'courses',
  STUDENTS: 'students',
  AUTH_TOKEN: 'auth_token'
};

export default async function handler(req, res) {
  // Universal CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version'
  );

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Check if MongoDB environment is configured
  if (!process.env.MONGODB_URI) {
    return res.status(200).json({
      success: false,
      isConfigured: false,
      message: 'MONGODB_URI is not configured. The frontend is operating in local fallback mode.'
    });
  }

  let db;
  try {
    db = await getDatabase();
  } catch (dbErr) {
    console.error('[MongoDB Connection Error]:', dbErr);
    return res.status(500).json({
      success: false,
      error: 'Database connection failed',
      message: dbErr.message
    });
  }

  // --------------------------------------------------------------------------
  // GET: Fetch all Academy Data
  // --------------------------------------------------------------------------
  if (req.method === 'GET') {
    try {
      const [profileDoc, coursesList, studentsList, authTokenDoc] = await Promise.all([
        db.collection(COLLECTIONS.PROFILE).findOne({}, { projection: { _id: 0 } }),
        db.collection(COLLECTIONS.COURSES).find({}, { projection: { _id: 0 } }).toArray(),
        db.collection(COLLECTIONS.STUDENTS).find({}, { projection: { _id: 0 } }).sort({ _id: -1 }).toArray(),
        db.collection(COLLECTIONS.AUTH_TOKEN).findOne({}, { projection: { _id: 0 } })
      ]);

      return res.status(200).json({
        success: true,
        isConfigured: true,
        data: {
          profile: profileDoc || null,
          courses: Array.isArray(coursesList) ? coursesList : [],
          students: Array.isArray(studentsList) ? studentsList : [],
          authToken: authTokenDoc || null
        }
      });
    } catch (error) {
      console.error('[API GET Error]:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to retrieve data from MongoDB',
        message: error.message
      });
    }
  }

  // --------------------------------------------------------------------------
  // POST: Mutate Academy Data
  // --------------------------------------------------------------------------
  if (req.method === 'POST') {
    try {
      const { action, payload } = req.body || {};

      if (!action) {
        return res.status(400).json({ success: false, error: 'Missing action parameter' });
      }

      switch (action) {
        // 1. Save Academy Profile
        case 'save_profile': {
          if (!payload?.profile) {
            return res.status(400).json({ success: false, error: 'Missing profile in payload' });
          }
          await db.collection(COLLECTIONS.PROFILE).updateOne(
            {},
            { $set: payload.profile },
            { upsert: true }
          );
          return res.status(200).json({ success: true, profile: payload.profile });
        }

        // 2. Save All Courses (Batch replace)
        case 'save_courses': {
          const courses = Array.isArray(payload?.courses) ? payload.courses : [];
          await db.collection(COLLECTIONS.COURSES).deleteMany({});
          if (courses.length > 0) {
            await db.collection(COLLECTIONS.COURSES).insertMany(courses);
          }
          return res.status(200).json({ success: true, courses });
        }

        // 3. Add or Update a Single Course
        case 'add_course': {
          const course = payload?.course;
          if (!course || !course.id) {
            return res.status(400).json({ success: false, error: 'Invalid course payload' });
          }
          await db.collection(COLLECTIONS.COURSES).updateOne(
            { id: course.id },
            { $set: course },
            { upsert: true }
          );
          const updatedCourses = await db.collection(COLLECTIONS.COURSES).find({}, { projection: { _id: 0 } }).toArray();
          return res.status(200).json({ success: true, courses: updatedCourses });
        }

        // 4. Delete Course
        case 'delete_course': {
          const courseId = payload?.courseId;
          if (!courseId) {
            return res.status(400).json({ success: false, error: 'Missing courseId' });
          }
          await db.collection(COLLECTIONS.COURSES).deleteOne({ id: courseId });
          const updatedCourses = await db.collection(COLLECTIONS.COURSES).find({}, { projection: { _id: 0 } }).toArray();
          return res.status(200).json({ success: true, courses: updatedCourses });
        }

        // 5. Save All Students (Batch replace)
        case 'save_students': {
          const students = Array.isArray(payload?.students) ? payload.students : [];
          await db.collection(COLLECTIONS.STUDENTS).deleteMany({});
          if (students.length > 0) {
            await db.collection(COLLECTIONS.STUDENTS).insertMany(students);
          }
          return res.status(200).json({ success: true, students });
        }

        // 6. Add New Student Registration (From Public Site)
        case 'add_student': {
          const student = payload?.student;
          if (!student || !student.fullName || !student.phone) {
            return res.status(400).json({ success: false, error: 'Invalid student registration payload' });
          }
          await db.collection(COLLECTIONS.STUDENTS).insertOne(student);
          return res.status(200).json({ success: true, student });
        }

        // 7. Update Single Student (From Admin Portal)
        case 'update_student': {
          const { studentId, updatedData } = payload || {};
          if (!studentId || !updatedData) {
            return res.status(400).json({ success: false, error: 'Missing studentId or updatedData' });
          }
          const result = await db.collection(COLLECTIONS.STUDENTS).updateOne(
            { id: studentId },
            { $set: updatedData }
          );
          if (result.matchedCount > 0) {
            const updatedStudent = await db.collection(COLLECTIONS.STUDENTS).findOne({ id: studentId }, { projection: { _id: 0 } });
            return res.status(200).json({ success: true, student: updatedStudent });
          }
          return res.status(404).json({ success: false, error: 'Student not found' });
        }

        // 8. Bulk Update Students (e.g. Mark as Completed)
        case 'bulk_update_students': {
          const { studentIds, updateFields } = payload || {};
          if (!Array.isArray(studentIds) || !updateFields) {
            return res.status(400).json({ success: false, error: 'Invalid bulk update payload' });
          }
          const result = await db.collection(COLLECTIONS.STUDENTS).updateMany(
            { id: { $in: studentIds } },
            { $set: updateFields }
          );
          return res.status(200).json({ success: true, modifiedCount: result.modifiedCount });
        }

        // 9. Delete Student
        case 'delete_student': {
          const studentId = payload?.studentId;
          if (!studentId) {
            return res.status(400).json({ success: false, error: 'Missing studentId' });
          }
          await db.collection(COLLECTIONS.STUDENTS).deleteOne({ id: studentId });
          return res.status(200).json({ success: true, studentId });
        }

        // 10. Save Authentication Token (6-Digit OTP)
        case 'save_auth_token': {
          const token = payload?.token;
          if (!token || !token.code) {
            return res.status(400).json({ success: false, error: 'Invalid token payload' });
          }
          await db.collection(COLLECTIONS.AUTH_TOKEN).updateOne(
            {},
            { $set: token },
            { upsert: true }
          );
          return res.status(200).json({ success: true, token });
        }

        // 11. Clear All Data (Admin Demo Reset)
        case 'clear_all': {
          await Promise.all([
            db.collection(COLLECTIONS.COURSES).deleteMany({}),
            db.collection(COLLECTIONS.STUDENTS).deleteMany({})
          ]);
          return res.status(200).json({ success: true, message: 'All student and course records cleared from MongoDB' });
        }

        default:
          return res.status(400).json({ success: false, error: `Unknown action: ${action}` });
      }
    } catch (error) {
      console.error('[API POST Error]:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to process mutation in MongoDB',
        message: error.message
      });
    }
  }

  return res.status(405).json({ success: false, error: `Method ${req.method} not allowed` });
}
