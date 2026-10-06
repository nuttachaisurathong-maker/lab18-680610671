import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  zEnrollmentBody,
  zStudentId,
  zCourseId,
} from "../libs/zodValidators.ts";

export const zEnrollmentPutBody = z.object({
  studentId: zStudentId,
  courseId: zCourseId,
  newCourseId: zCourseId,
});

import type { CustomRequest } from "../libs/types.ts";

// import authentication middleware
import { authenticateToken } from "../middlewares/authenMiddleware.ts";
import { checkRoles } from "../middlewares/checkRolesDBMiddleware.ts";

// import database
import { PrismaClient } from "../../generated/prisma/client.ts";
const prisma = new PrismaClient();

const router = Router();

// GET /api/v3/enrollments
// ADMIN: get all enrollments, STUDENT: get only his own enrollments
router.get(
  "/",
  authenticateToken,
  checkRoles,
  async (req: CustomRequest, res: Response) => {
    try {
      const user = req.user;
      const enrollments = await prisma.enrollment.findMany({
        where:
          user?.role === "STUDENT" ? { studentId: user.studentId ?? "" } : {},
        orderBy: { createdAt: "asc" },
      });

      return res.json({
        success: true,
        data: enrollments,
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: "Something is wrong, please try again",
        error: err,
      });
    }
  },
);

// POST /api/v3/enrollments, body = {studentId, courseId}
// ADMIN: enroll any student, STUDENT: enroll only himself
router.post(
  "/",
  authenticateToken,
  checkRoles,
  async (req: CustomRequest, res: Response) => {
    try {
      // validate req.body
      const result = zEnrollmentBody.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: result.error.issues[0]?.message,
        });
      }
      const { studentId, courseId } = result.data;

      // STUDENT can enroll only himself
      const user = req.user;
      if (user?.role === "STUDENT" && studentId !== user.studentId) {
        return res.status(403).json({
          success: false,
          message: "Forbidden access",
        });
      }

      // check if student and course exist
      const student = await prisma.student.findUnique({
        where: { studentId },
      });
      if (!student) {
        return res.status(404).json({
          success: false,
          message: `Student ${studentId} does not exists`,
        });
      }
      const course = await prisma.course.findUnique({ where: { courseId } });
      if (!course) {
        return res.status(404).json({
          success: false,
          message: `Course ${courseId} does not exists`,
        });
      }

      // check if the student already enrolled in this course
      const enrolled = await prisma.enrollment.findFirst({
        where: { studentId, courseId },
      });
      if (enrolled) {
        return res.status(409).json({
          success: false,
          message: `Student ${studentId} has already enrolled in ${courseId}`,
        });
      }

      const created = await prisma.enrollment.create({
        data: { studentId, courseId },
      });

      return res.status(201).json({
        success: true,
        data: created,
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: "Something is wrong, please try again",
        error: err,
      });
    }
  },
);

// PUT /api/v3/enrollments, body = {studentId, courseId, newCourseId}
// เปลี่ยนวิชาที่ลงทะเบียนไว้ (courseId → newCourseId)
// - ADMIN แก้ได้ทุกคน / STUDENT แก้ได้แค่ของตัวเอง (403)
// - validate body (400), ยังไม่ได้ลงวิชาเดิม (404), วิชาใหม่ = วิชาเดิม (400),
//   วิชาใหม่ไม่มีจริง (404), ลงวิชาใหม่ไว้แล้ว (409)
router.put(
  "/",
  authenticateToken,
  checkRoles,
  async (req: CustomRequest, res: Response) => {
    try {
      // validate body
      const result = zEnrollmentPutBody.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: result.error.issues[0]?.message,
        });
      }
      const { studentId, courseId, newCourseId } = result.data;

      // Role check: ADMIN can edit for anyone, STUDENT can edit only for self
      const user = req.user;
      if (user?.role === "STUDENT" && studentId !== user.studentId) {
        return res.status(403).json({
          success: false,
          message: "Forbidden access",
        });
      }

      // check if student has enrolled in old course
      const oldEnrollment = await prisma.enrollment.findFirst({
        where: { studentId, courseId },
      });
      if (!oldEnrollment) {
        return res.status(404).json({
          success: false,
          message: `Student ${studentId} has not enrolled in ${courseId}`,
        });
      }

      // check if new course is the same as old course
      if (courseId === newCourseId) {
        return res.status(400).json({
          success: false,
          message: "New course must be different from current course",
        });
      }

      // check if new course exists
      const newCourse = await prisma.course.findUnique({
        where: { courseId: newCourseId },
      });
      if (!newCourse) {
        return res.status(404).json({
          success: false,
          message: `Course ${newCourseId} does not exists`,
        });
      }

      // check if already enrolled in new course
      const alreadyEnrolledNew = await prisma.enrollment.findFirst({
        where: { studentId, courseId: newCourseId },
      });
      if (alreadyEnrolledNew) {
        return res.status(409).json({
          success: false,
          message: `Student ${studentId} has already enrolled in ${newCourseId}`,
        });
      }

      // update enrollment to newCourseId
      const updated = await prisma.enrollment.update({
        where: { id: oldEnrollment.id },
        data: { courseId: newCourseId },
      });

      return res.status(200).json({
        success: true,
        message: `Enrollment for student ${studentId} changed from ${courseId} to ${newCourseId}`,
        data: updated,
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: "Something is wrong, please try again",
        error: err,
      });
    }
  },
);

// DELETE /api/v3/enrollments, body = {studentId, courseId}
// ยกเลิกการลงทะเบียน (drop)
// - ADMIN ลบได้ทุกคน / STUDENT ลบได้แค่ของตัวเอง (403)
// - validate body (400), ไม่พบการลงทะเบียน (404)
router.delete(
  "/",
  authenticateToken,
  checkRoles,
  async (req: CustomRequest, res: Response) => {
    try {
      // validate body
      const result = zEnrollmentBody.safeParse(req.body);
      if (!result.success) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: result.error.issues[0]?.message,
        });
      }
      const { studentId, courseId } = result.data;

      // Role check: ADMIN can delete for anyone, STUDENT can delete only for self
      const user = req.user;
      if (user?.role === "STUDENT" && studentId !== user.studentId) {
        return res.status(403).json({
          success: false,
          message: "Forbidden access",
        });
      }

      // check if enrollment exists
      const enrollment = await prisma.enrollment.findFirst({
        where: { studentId, courseId },
      });
      if (!enrollment) {
        return res.status(404).json({
          success: false,
          message: `Enrollment for student ${studentId} in course ${courseId} does not exists`,
        });
      }

      // delete enrollment
      const deleted = await prisma.enrollment.delete({
        where: { id: enrollment.id },
      });

      return res.status(200).json({
        success: true,
        message: `Enrollment for student ${studentId} in course ${courseId} has been dropped successfully`,
        data: deleted,
      });
    } catch (err) {
      return res.status(500).json({
        success: false,
        message: "Something is wrong, please try again",
        error: err,
      });
    }
  },
);

export default router;
